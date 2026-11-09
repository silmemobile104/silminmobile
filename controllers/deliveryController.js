const path = require('path');
const axios = require('axios');
const DeliveryTransfer = require('../models/deliveryTransfer');
const { getDriveService, detectImageMimeType, uploadBufferToDrive } = require('../utils/googleDrive');
const { logActivity } = require('../utils/logger');

// @desc    ดึงรูปภาพจาก Google Drive ผ่าน Server Proxy เพื่อให้แสดงผลได้ทันทีในทุกเบราว์เซอร์โดยไม่ต้องดาวน์โหลด
// @route   GET /api/delivery/image/:fileId
exports.getDriveImage = async (req, res) => {
    try {
        const { fileId } = req.params;
        if (!fileId) {
            return res.status(400).send('Missing fileId');
        }

        let fileBuffer = null;
        let driveMimeType = '';

        // 1. ดึงข้อมูลไฟล์ผ่าน Google Drive API โดยตรง
        try {
            const drive = getDriveService();
            const response = await drive.files.get(
                { fileId, alt: 'media', supportsAllDrives: true },
                { responseType: 'arraybuffer' }
            );
            if (response && response.data) {
                fileBuffer = Buffer.from(response.data);
                driveMimeType = (response.headers && response.headers['content-type']) || '';
            }
        } catch (driveApiErr) {
            console.warn(`Drive API media fetch fallback for ${fileId}:`, driveApiErr.message || driveApiErr);
        }

        // 2. หากดึงผ่าน Drive API ไม่สำเร็จ ให้สลับดึงผ่านลิงก์ดาวน์โหลดตรงของ Google Drive อัตโนมัติ
        if (!fileBuffer || fileBuffer.length === 0) {
            const directDownloadUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
            const fallbackRes = await axios.get(directDownloadUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
                maxRedirects: 5
            });
            fileBuffer = Buffer.from(fallbackRes.data);
            driveMimeType = (fallbackRes.headers && fallbackRes.headers['content-type']) || '';
        }

        if (!fileBuffer || fileBuffer.length === 0) {
            return res.status(404).send('Image not found');
        }

        // 3. ตรวจสอบ Magic Bytes ของเนื้อไฟล์จริง เพื่อส่ง Content-Type ที่ถูกต้องให้เบราว์เซอร์แสดงผลทันที (แก้ปัญหา application/octet-stream)
        const realMimeType = detectImageMimeType(fileBuffer, driveMimeType);

        res.setHeader('Content-Type', realMimeType);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(fileBuffer);
    } catch (error) {
        console.error('getDriveImage Error:', error.message || error);
        return res.status(404).send('Unable to load image');
    }
};

// ตรวจสอบสิทธิ์ผู้บริหาร / แอดมิน
const isManagerOrAdmin = (user) => {
    return ['admin', 'manager', 'executive', 'hr'].includes(user.role);
};

// ตรวจสอบสิทธิ์ฝ่ายจัดส่ง / Logistics (รวมถึง แผนก/สาขา "ฝ่ายเทคนิค สนง.")
const isLogisticsRole = (user) => {
    const dept = (user.department || '').trim().toLowerCase();
    const branch = (user.branch || '').trim().toLowerCase();
    const role = (user.role || '').trim().toLowerCase();
    const combined = `${dept} ${branch}`;
    const keywords = [
        'logistics', 'จัดส่ง', 'ขนส่ง', 'ส่งของ', 'ส่งสินค้า', 'delivery', 'messenger', 'driver',
        'ฝ่ายเทคนิค สนง', 'เทคนิค สนง', 'ฝ่ายเทคนิค'
    ];
    return keywords.some(kw => dept.includes(kw) || branch.includes(kw) || combined.includes(kw)) ||
           ['logistics', 'delivery'].includes(role) ||
           isManagerOrAdmin(user);
};

// ฟังก์ชันช่วยแยกและจัดรูปแบบรหัสสินค้า / เลข IMEI (รองรับทั้ง 1 ชิ้น และหลายชิ้น)
const extractItemCodes = (item) => {
    if (!item) return [];
    if (Array.isArray(item.productCodes) && item.productCodes.length > 0) {
        return item.productCodes.map(c => String(c || '').trim()).filter(Boolean);
    }
    const raw = item.productCode || item.code || '';
    if (typeof raw === 'string' && raw.trim() !== '') {
        return raw.split(',').map(c => c.trim()).filter(Boolean);
    }
    return [];
};

// ฟังก์ชันช่วยอัปโหลดรูปภาพหลักฐานไปยัง Google Drive
const handleFileUpload = async (req, transfer, stepName = '') => {
    if (!req.file) return null;
    try {
        const ext = path.extname(req.file.originalname) || '.jpg';
        const fileName = `delivery_${transfer._id}_${Date.now()}${ext}`;
        const rawDriveUrl = await uploadBufferToDrive(req.file.buffer, req.file.mimetype, fileName);
        const idMatch = String(rawDriveUrl || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
        const driveUrl = idMatch ? `/api/delivery/image/${idMatch[1]}` : rawDriveUrl;

        transfer.deliveryProof = transfer.deliveryProof || {};
        transfer.deliveryProof.proofImageUrl = driveUrl;
        transfer.deliveryProof.updatedAt = new Date();
        transfer.deliveryProof.updatedBy = req.user._id;

        if (!Array.isArray(transfer.deliveryProof.proofImages)) {
            transfer.deliveryProof.proofImages = [];
        }
        transfer.deliveryProof.proofImages.push({
            url: driveUrl,
            step: stepName,
            uploadedAt: new Date(),
            uploadedBy: req.user._id
        });

        return driveUrl;
    } catch (uploadError) {
        console.error('Google Drive Upload Error:', uploadError);
        throw new Error('เกิดข้อผิดพลาดในการอัปโหลดรูปภาพไปยัง Google Drive: ' + uploadError.message);
    }
};

// @desc    ดึงรายการจัดส่งเครื่องทั้งหมด (แยกแท็บ, ค้นหา, กรองสาขา)
// @route   GET /api/delivery
exports.getDeliveryTransfers = async (req, res) => {
    try {
        const { tab = 'all', status, search, branchFilter } = req.query;
        const user = req.user;
        const rawBranch = (user.branch || '').trim();
        const hasBranch = rawBranch !== '' && rawBranch !== '-' && rawBranch.toLowerCase() !== 'null' && rawBranch.toLowerCase() !== 'none';
        const userBranch = hasBranch ? rawBranch : null;
        const isManagement = isManagerOrAdmin(user);
        const isLogistics = isLogisticsRole(user);
        // พนักงานที่ไม่มีสาขา, ฝ่ายจัดส่ง (รวมถึง ฝ่ายเทคนิค สนง.) หรือผู้บริหาร สามารถดูรายการได้ทุกสาขา
        const canViewAll = isManagement || !hasBranch || isLogistics;

        let query = {};
        if (user.companyId) {
            query.companyId = user.companyId;
        }

        const effectiveBranch = (canViewAll && branchFilter && branchFilter !== 'all') ? branchFilter : null;
        const companyFilter = user.companyId ? { companyId: user.companyId } : {};

        // เงื่อนไขงานของฝ่ายจัดส่งที่ยังไม่เสร็จสิ้นทั้ง 2 ขั้นตอน (รอรับจากต้นทาง หรือ รับแล้วรอนำส่งปลายทาง)
        const logisticsPendingStepsOr = [
            { status: { $in: ['ready_to_ship', 'picked_up'] } },
            { status: 'in_transit', 'signatures.courierDeliverSign.user': { $exists: false } }
        ];

        if (tab === 'to_prepare') {
            // แท็บ "งานที่ต้องจัดเตรียมส่ง (สาขาต้นทาง)"
            if (effectiveBranch) {
                query.sourceBranch = effectiveBranch;
            } else if (!canViewAll) {
                query.sourceBranch = userBranch;
            }
            query.status = 'pending';
        } else if (tab === 'waiting_source') {
            // แท็บ "รายการที่รอสาขาต้นทางตอบรับ" (ขอเครื่องไปแล้ว แต่สาขาต้นทางยังไม่ได้กดเตรียมของ)
            if (effectiveBranch) {
                query.destinationBranch = effectiveBranch;
            } else if (!canViewAll) {
                query.$or = [
                    { destinationBranch: userBranch },
                    { createdBy: user._id }
                ];
            }
            query.status = 'pending';
        } else if (tab === 'logistics') {
            // แท็บ "งานของฝ่ายจัดส่ง" (รวมงานรอรับจากสาขาต้นทาง และงานรับแล้วรอนำส่งสาขาปลายทาง)
            query.deliveryMethod = 'logistics';
            if (effectiveBranch) {
                query.$and = [
                    { $or: logisticsPendingStepsOr },
                    { $or: [{ sourceBranch: effectiveBranch }, { destinationBranch: effectiveBranch }] }
                ];
            } else if (!canViewAll && !isLogistics) {
                query.$and = [
                    { $or: logisticsPendingStepsOr },
                    { $or: [{ sourceBranch: userBranch }, { destinationBranch: userBranch }] }
                ];
            } else {
                query.$or = logisticsPendingStepsOr;
            }
        } else if (tab === 'receiving') {
            // แท็บ "งานรอตรวจรับเข้าสาขา (สาขาปลายทาง)"
            if (effectiveBranch) {
                query.destinationBranch = effectiveBranch;
            } else if (!canViewAll) {
                query.destinationBranch = userBranch;
            }
            query.status = { $in: ['in_transit', 'picked_up', 'ready_to_ship'] };
        } else if (tab === 'completed') {
            // แท็บ "ประวัติเสร็จสิ้น"
            query.status = 'completed';
            if (effectiveBranch) {
                query.$or = [{ sourceBranch: effectiveBranch }, { destinationBranch: effectiveBranch }];
            } else if (!canViewAll && !isLogistics) {
                query.$or = [{ sourceBranch: userBranch }, { destinationBranch: userBranch }, { createdBy: user._id }];
            }
        } else {
            // แท็บ "ทั้งหมด"
            if (status) {
                query.status = status;
            }
            if (effectiveBranch) {
                query.$or = [{ sourceBranch: effectiveBranch }, { destinationBranch: effectiveBranch }];
            } else if (!canViewAll && !isLogistics) {
                query.$or = [{ sourceBranch: userBranch }, { destinationBranch: userBranch }, { createdBy: user._id }];
            }
        }

        // ค้นหาข้อความ (Search)
        if (search && search.trim() !== '') {
            const regex = new RegExp(search.trim(), 'i');
            const searchConditions = [
                { title: regex },
                { transferNumber: regex },
                { 'items.productCode': regex },
                { 'items.productCodes': regex },
                { 'items.productName': regex },
                { 'deliveryProof.trackingNumber': regex },
                { sourceBranch: regex },
                { destinationBranch: regex },
                { note: regex }
            ];

            if (query.$and) {
                query.$and.push({ $or: searchConditions });
            } else if (query.$or) {
                query.$and = [
                    { $or: query.$or },
                    { $or: searchConditions }
                ];
                delete query.$or;
            } else {
                query.$or = searchConditions;
            }
        }

        const transfers = await DeliveryTransfer.find(query)
            .populate('createdBy', 'name username branch department role')
            .populate('signatures.requesterSign.user', 'name username branch department role')
            .populate('signatures.preparerSign.user', 'name username branch department role')
            .populate('signatures.courierPickupSign.user', 'name username branch department role')
            .populate('signatures.courierDeliverSign.user', 'name username branch department role')
            .populate('signatures.receiverSign.user', 'name username branch department role')
            .populate('deliveryProof.updatedBy', 'name username branch department role')
            .populate('receivingCondition.receivedBy', 'name username branch department role')
            .sort({ updatedAt: -1, createdAt: -1 });

        // คำนวณยอด Badge ของแต่ละแท็บ (สอดคล้องกับสิทธิ์และตัวกรองสาขาที่เลือก)
        const targetBranchForCount = effectiveBranch || (!canViewAll ? userBranch : null);
        const branchOrFilter = targetBranchForCount
            ? { $or: [{ sourceBranch: targetBranchForCount }, { destinationBranch: targetBranchForCount }] }
            : {};

        const logisticsCountQuery = {
            ...companyFilter,
            deliveryMethod: 'logistics',
            ...(targetBranchForCount
                ? {
                    $and: [
                        { $or: logisticsPendingStepsOr },
                        { $or: [{ sourceBranch: targetBranchForCount }, { destinationBranch: targetBranchForCount }] }
                    ]
                }
                : { $or: logisticsPendingStepsOr })
        };

        const [prepareCount, waitingSourceCount, logisticsCount, receiveCount, completedCount] = await Promise.all([
            DeliveryTransfer.countDocuments({
                ...companyFilter,
                status: 'pending',
                ...(targetBranchForCount ? { sourceBranch: targetBranchForCount } : {})
            }),
            DeliveryTransfer.countDocuments({
                ...companyFilter,
                status: 'pending',
                ...(effectiveBranch
                    ? { destinationBranch: effectiveBranch }
                    : (!canViewAll ? { $or: [{ destinationBranch: userBranch }, { createdBy: user._id }] } : {}))
            }),
            DeliveryTransfer.countDocuments(logisticsCountQuery),
            DeliveryTransfer.countDocuments({
                ...companyFilter,
                status: { $in: ['in_transit', 'picked_up', 'ready_to_ship'] },
                ...(targetBranchForCount ? { destinationBranch: targetBranchForCount } : {})
            }),
            DeliveryTransfer.countDocuments({
                ...companyFilter,
                ...branchOrFilter,
                status: 'completed'
            })
        ]);

        res.status(200).json({
            success: true,
            data: transfers,
            counts: {
                to_prepare: prepareCount,
                waiting_source: waitingSourceCount,
                logistics: logisticsCount,
                receiving: receiveCount,
                completed: completedCount
            },
            currentUser: {
                id: user._id,
                name: user.name,
                username: user.username,
                role: user.role,
                department: user.department,
                branch: userBranch || '',
                hasBranch,
                canViewAll,
                isLogistics,
                isManagement
            }
        });
    } catch (error) {
        console.error('getDeliveryTransfers Error:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

// @desc    ดึงข้อมูลรายการจัดส่งเดี่ยวตาม ID
// @route   GET /api/delivery/:id
exports.getTransferById = async (req, res) => {
    try {
        const transfer = await DeliveryTransfer.findById(req.params.id)
            .populate('createdBy', 'name username branch department role')
            .populate('signatures.requesterSign.user', 'name username branch department role')
            .populate('signatures.preparerSign.user', 'name username branch department role')
            .populate('signatures.courierPickupSign.user', 'name username branch department role')
            .populate('signatures.courierDeliverSign.user', 'name username branch department role')
            .populate('signatures.receiverSign.user', 'name username branch department role')
            .populate('deliveryProof.updatedBy', 'name username branch department role')
            .populate('receivingCondition.receivedBy', 'name username branch department role');

        if (!transfer) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการที่ระบุ' });
        }

        res.status(200).json({ success: true, data: transfer });
    } catch (error) {
        console.error('getTransferById Error:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

// @desc    แก้ไขข้อมูลรายการจัดส่ง (ทุกอย่าง ทุกขั้นตอน สาขาที่เกี่ยวข้องสามารถแก้ไขได้)
// @route   PUT /api/delivery/:id
exports.updateDeliveryTransfer = async (req, res) => {
    try {
        const { id } = req.params;
        let {
            title,
            sourceBranch,
            destinationBranch,
            items,
            status,
            deliveryMethod,
            trackingNumber,
            note
        } = req.body;

        if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch(e) {}
        }

        const transfer = await DeliveryTransfer.findById(id);
        if (!transfer) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการที่ระบุ' });
        }

        const rawBranch = (req.user.branch || '').trim();
        const hasBranch = rawBranch !== '' && rawBranch !== '-' && rawBranch.toLowerCase() !== 'null' && rawBranch.toLowerCase() !== 'none';
        const isManagement = isManagerOrAdmin(req.user);
        const isLogistics = isLogisticsRole(req.user);

        // ตรวจสอบว่าเป็นสาขาที่เกี่ยวข้อง (สาขาต้นทาง, สาขาปลายทาง, ผู้สร้าง หรือแอดมิน/จัดส่ง/พนักงานที่ไม่มีสาขา)
        const isRelatedBranch = !hasBranch || isManagement || isLogistics ||
            rawBranch === transfer.sourceBranch ||
            rawBranch === transfer.destinationBranch ||
            String(transfer.createdBy) === String(req.user._id);

        if (!isRelatedBranch) {
            return res.status(403).json({
                success: false,
                message: 'คุณไม่มีสิทธิ์แก้ไขรายการนี้ (เฉพาะสาขาต้นทาง, สาขาปลายทาง หรือผู้ดูแลระบบ)'
            });
        }

        // หากมีไฟล์รูปภาพส่งมาด้วย ให้อัปโหลดไปยัง Google Drive ทันที
        if (req.file) {
            await handleFileUpload(req, transfer, 'แก้ไขข้อมูล');
        }

        // อัปเดตหัวข้อรายการ
        if (title && title.trim()) {
            transfer.title = title.trim();
        }

        // อัปเดตสาขาต้นทาง / ปลายทาง
        if (sourceBranch) {
            transfer.sourceBranch = sourceBranch.trim();
        }
        if (destinationBranch) {
            transfer.destinationBranch = destinationBranch.trim();
        }

        if (transfer.sourceBranch === transfer.destinationBranch) {
            return res.status(400).json({
                success: false,
                message: 'สาขาต้นทางและสาขาปลายทางต้องไม่เป็นสาขาเดียวกัน'
            });
        }

        // อัปเดตสถานะ
        if (status && ['pending', 'ready_to_ship', 'picked_up', 'in_transit', 'completed', 'canceled'].includes(status)) {
            transfer.status = status;
        }

        // อัปเดตรูปแบบการจัดส่ง
        if (deliveryMethod !== undefined) {
            transfer.deliveryMethod = ['direct', 'logistics'].includes(deliveryMethod) ? deliveryMethod : null;
        }

        // อัปเดตเลขพัสดุ
        if (trackingNumber !== undefined) {
            transfer.deliveryProof = transfer.deliveryProof || {};
            transfer.deliveryProof.trackingNumber = (trackingNumber || '').trim();
            transfer.deliveryProof.updatedAt = new Date();
            transfer.deliveryProof.updatedBy = req.user._id;
        }

        // อัปเดตหมายเหตุ
        if (note !== undefined) {
            transfer.note = note ? note.trim() : '';
        }

        // อัปเดตสภาพความสมบูรณ์ของสินค้า (เฉพาะกรณีตรวจรับแล้วหรือสถานะเป็น completed)
        if (req.body.conditionStatus && (transfer.status === 'completed' || (transfer.receivingCondition && transfer.receivingCondition.receivedAt))) {
            const statusLabelMap = {
                perfect: 'สมบูรณ์ 100% (ปกติ)',
                minor_defect: 'มีตำหนิ / กล่องบุบ',
                damaged: 'ชำรุด / แตกหัก',
                incomplete: 'อุปกรณ์ไม่ครบ'
            };
            transfer.receivingCondition = transfer.receivingCondition || {};
            transfer.receivingCondition.status = req.body.conditionStatus;
            transfer.receivingCondition.statusLabel = statusLabelMap[req.body.conditionStatus] || req.body.conditionStatus;
        }

        // อัปเดตรายการสินค้า
        if (items && Array.isArray(items) && items.length > 0) {
            for (let i = 0; i < items.length; i++) {
                const pName = (items[i].productName || items[i].name || '').trim();
                if (!pName) {
                    return res.status(400).json({
                        success: false,
                        message: `กรุณาระบุชื่อสินค้าในรายการที่ ${i + 1}`
                    });
                }
            }

            transfer.items = items.map(item => {
                const codes = extractItemCodes(item);
                return {
                    productCode: codes.join(', '),
                    productCodes: codes,
                    productName: (item.productName || item.name || '').trim(),
                    quantity: Math.max(1, Number(item.quantity) || 1),
                    note: item.note || ''
                };
            });
            transfer.markModified('items');
        }

        await transfer.save();

        await logActivity(req, 'UPDATE', 'DeliveryTransfer',
            `แก้ไขข้อมูลรายการจัดส่ง: "${transfer.title}" (${transfer.transferNumber}) โดย ${req.user.name || req.user.username}`,
            { id: transfer._id, transferNumber: transfer.transferNumber, status: transfer.status }
        );

        res.status(200).json({
            success: true,
            message: 'บันทึกการแก้ไขข้อมูลเรียบร้อยแล้ว',
            data: transfer
        });
    } catch (error) {
        console.error('updateDeliveryTransfer Error:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

// @desc    สร้างรายการขอจัดส่ง/โอนย้ายเครื่องใหม่ (สาขาที่สร้างคือสาขาที่ขอรับของ = สาขาปลายทาง)
// @route   POST /api/delivery
exports.createDeliveryTransfer = async (req, res) => {
    try {
        const { title, sourceBranch, destinationBranch, branch, items, deliveryMethod, note } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุหัวข้อรายการ' });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุสินค้าอย่างน้อย 1 รายการ' });
        }

        if (!sourceBranch) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุสาขาต้นทาง (สาขาที่ต้องการขอเครื่อง)' });
        }

        // สาขาที่สร้างรายการ (อนุญาตให้เลือกสาขาปลายทางอื่นได้ โดยค่าเริ่มต้นเป็นสาขาของตัวเอง)
        const rawBranch = (req.user.branch || '').trim();
        const hasBranch = rawBranch !== '' && rawBranch !== '-' && rawBranch.toLowerCase() !== 'null' && rawBranch.toLowerCase() !== 'none';

        const targetBranch = String(destinationBranch || branch || (hasBranch ? rawBranch : '')).trim();

        if (!targetBranch) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุสาขาปลายทาง (ผู้ขอรับของ)' });
        }

        if (sourceBranch === targetBranch) {
            return res.status(400).json({ 
                success: false, 
                message: 'สาขาต้นทาง (ผู้จัดส่ง) และสาขาปลายทาง (ผู้ขอรับของ) ต้องไม่เป็นสาขาเดียวกัน' 
            });
        }

        // ตรวจสอบว่าต้องใส่ชื่อสินค้าครบทุกรายการ
        for (let i = 0; i < items.length; i++) {
            const pName = (items[i].productName || items[i].name || '').trim();
            if (!pName) {
                return res.status(400).json({ success: false, message: `กรุณาระบุชื่อสินค้าในรายการที่ ${i + 1}` });
            }
        }

        const mappedItems = items.map(item => {
            const codes = extractItemCodes(item);
            return {
                productCode: codes.join(', '),
                productCodes: codes,
                productName: (item.productName || item.name || '').trim(),
                quantity: Math.max(1, Number(item.quantity) || 1),
                note: item.note || ''
            };
        });

        const newTransfer = new DeliveryTransfer({
            companyId: req.user.companyId || 'company_1_id',
            title: title.trim(),
            sourceBranch: sourceBranch,             // สาขาต้นทาง ผู้เตรียมของ
            destinationBranch: targetBranch,        // สาขาปลายทาง ผู้ขอ/รอรับ
            deliveryMethod: deliveryMethod || null,
            items: mappedItems,
            note: note || '',
            status: 'pending',
            createdBy: req.user._id,
            signatures: {
                requesterSign: {
                    user: req.user._id,
                    name: req.user.name || req.user.username,
                    department: req.user.department || '',
                    branch: hasBranch ? rawBranch : targetBranch,
                    role: req.user.role || '',
                    date: new Date()
                }
            }
        });

        await newTransfer.save();

        await logActivity(req, 'CREATE', 'DeliveryTransfer', 
            `สร้างรายการขอโอนย้ายเครื่อง: "${newTransfer.title}" (ขอรับเข้า ${targetBranch} จาก ${sourceBranch})`,
            { id: newTransfer._id, transferNumber: newTransfer.transferNumber, sourceBranch, destinationBranch: targetBranch }
        );

        res.status(201).json({ success: true, message: 'สร้างรายการขอโอนย้ายเรียบร้อยแล้ว', data: newTransfer });
    } catch (error) {
        console.error('createDeliveryTransfer Error:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

// @desc    ขั้นตอนที่ 1: สาขาต้นทางลงชื่อเตรียมของ
// @route   PUT /api/delivery/:id/prepare
exports.acknowledgeAndPrepare = async (req, res) => {
    try {
        const { id } = req.params;
        let { deliveryMethod, trackingNumber, note, items } = req.body;

        if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch(e) {}
        }

        const transfer = await DeliveryTransfer.findById(id);
        if (!transfer) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการที่ระบุ' });
        }

        if (!['direct', 'logistics'].includes(deliveryMethod)) {
            return res.status(400).json({ success: false, message: 'กรุณาเลือกรูปแบบการจัดส่ง (ส่งตรงระหว่างสาขา: direct หรือ ส่งผ่านฝ่ายจัดส่ง: logistics)' });
        }

        if (deliveryMethod === 'direct' && (!trackingNumber || !trackingNumber.trim())) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุเลขพัสดุ / หมายเลขอ้างอิง (กรณีส่งตรง)' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'กรุณาแนบรูปภาพหลักฐาน / สภาพสินค้าและกล่อง' });
        }

        // แนบรูปถ่ายหลักฐานตอนเตรียมของขึ้น Google Drive ทันที
        await handleFileUpload(req, transfer, 'เตรียมจัดส่ง');

        // ตรวจสอบและบันทึกรหัสสินค้า / เลข IMEI ที่สาขาต้นทางระบุตอนเตรียมของ
        if (items && Array.isArray(items)) {
            for (let i = 0; i < transfer.items.length; i++) {
                const incomingItem = items[i];
                const codes = extractItemCodes(incomingItem);
                const qty = Math.max(1, Number(transfer.items[i].quantity) || 1);
                if (codes.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: `กรุณาระบุรหัสสินค้า / เลข IMEI สำหรับ "${transfer.items[i].productName}" (รายการที่ ${i + 1})`
                    });
                }
                if (qty > 1 && Array.isArray(incomingItem?.productCodes) && codes.length < qty) {
                    return res.status(400).json({
                        success: false,
                        message: `กรุณาระบุรหัสสินค้า / เลข IMEI ให้ครบทั้ง ${qty} ชิ้น สำหรับ "${transfer.items[i].productName}"`
                    });
                }
                transfer.items[i].productCodes = codes;
                transfer.items[i].productCode = codes.join(', ');
            }
            transfer.markModified('items');
        } else {
            // หากไม่ได้ส่งรายการ items มา ให้ตรวจว่ามีรหัสสินค้าครบถ้วนอยู่แล้วหรือไม่
            for (let i = 0; i < transfer.items.length; i++) {
                const existingCodes = extractItemCodes(transfer.items[i]);
                if (existingCodes.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: `กรุณาระบุรหัสสินค้า / เลข IMEI สำหรับ "${transfer.items[i].productName}" (รายการที่ ${i + 1})`
                    });
                }
                transfer.items[i].productCodes = existingCodes;
                transfer.items[i].productCode = existingCodes.join(', ');
            }
        }

        // Digital Footprint: preparerSign
        transfer.signatures = transfer.signatures || {};
        transfer.signatures.preparerSign = {
            user: req.user._id,
            name: req.user.name || req.user.username,
            department: req.user.department || '',
            branch: req.user.branch || transfer.sourceBranch,
            role: req.user.role || '',
            date: new Date()
        };

        transfer.deliveryMethod = deliveryMethod;

        if (note && note.trim()) {
            transfer.note = transfer.note 
                ? `${transfer.note}\n[เตรียมของโดย ${req.user.name}]: ${note.trim()}` 
                : `[เตรียมของโดย ${req.user.name}]: ${note.trim()}`;
        }

        if (deliveryMethod === 'direct') {
            // ส่งตรงระหว่างสาขา -> อยู่ระหว่างจัดส่งทันที
            transfer.status = 'in_transit';
            if (trackingNumber && trackingNumber.trim()) {
                transfer.deliveryProof = transfer.deliveryProof || {};
                transfer.deliveryProof.trackingNumber = trackingNumber.trim();
                transfer.deliveryProof.updatedAt = new Date();
                transfer.deliveryProof.updatedBy = req.user._id;
            }
        } else {
            // ส่งผ่านฝ่ายจัดส่ง (Logistics) -> รอขนส่งมารับของ
            transfer.status = 'ready_to_ship';
        }

        await transfer.save();

        await logActivity(req, 'UPDATE', 'DeliveryTransfer',
            `สาขา ${transfer.sourceBranch} ลงชื่อเตรียมของ (${deliveryMethod === 'direct' ? 'ส่งตรง' : 'ผ่านจัดส่ง'}): "${transfer.title}"`,
            { id: transfer._id, deliveryMethod, status: transfer.status }
        );

        res.status(200).json({ success: true, message: 'ลงชื่อเตรียมจัดส่งเรียบร้อยแล้ว', data: transfer });
    } catch (error) {
        console.error('acknowledgeAndPrepare Error:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

// @desc    ขั้นตอนที่ 2.1 (ฝ่ายจัดส่ง ขั้นตอนที่ 1): รับเครื่องจากสาขาต้นทาง
// @route   PUT /api/delivery/:id/pickup
exports.courierPickup = async (req, res) => {
    try {
        const { id } = req.params;
        const { trackingNumber, note } = req.body;

        const transfer = await DeliveryTransfer.findById(id);
        if (!transfer) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการที่ระบุ' });
        }

        // แนบรูปถ่ายหลักฐานตอนขนส่งรับของจากสาขาต้นทางขึ้น Google Drive ทันที
        if (req.file) {
            await handleFileUpload(req, transfer, 'จัดส่งรับเครื่องจากต้นทาง');
        }

        // Digital Footprint: courierPickupSign
        transfer.signatures = transfer.signatures || {};
        transfer.signatures.courierPickupSign = {
            user: req.user._id,
            name: req.user.name || req.user.username,
            department: req.user.branch || req.user.department || 'ฝ่ายจัดส่ง',
            branch: req.user.branch || '',
            role: req.user.role || '',
            date: new Date()
        };

        // เปลี่ยนสถานะเป็น picked_up (รับเครื่องจากต้นทางแล้ว รอนำส่งสาขาปลายทาง)
        transfer.status = 'picked_up';

        if (trackingNumber && trackingNumber.trim()) {
            transfer.deliveryProof = transfer.deliveryProof || {};
            transfer.deliveryProof.trackingNumber = trackingNumber.trim();
            transfer.deliveryProof.updatedAt = new Date();
            transfer.deliveryProof.updatedBy = req.user._id;
        }

        if (note && note.trim()) {
            transfer.note = transfer.note 
                ? `${transfer.note}\n[จัดส่งรับเครื่องจากสาขา ${transfer.sourceBranch} โดย ${req.user.name}]: ${note.trim()}` 
                : `[จัดส่งรับเครื่องจากสาขา ${transfer.sourceBranch} โดย ${req.user.name}]: ${note.trim()}`;
        }

        await transfer.save();

        await logActivity(req, 'UPDATE', 'DeliveryTransfer',
            `ฝ่ายจัดส่งรับเครื่องจากสาขาต้นทาง (${transfer.sourceBranch}): "${transfer.title}"`,
            { id: transfer._id, status: transfer.status }
        );

        res.status(200).json({ success: true, message: 'ฝ่ายจัดส่งลงชื่อรับเครื่องจากสาขาต้นทางเรียบร้อยแล้ว', data: transfer });
    } catch (error) {
        console.error('courierPickup Error:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

// @desc    ขั้นตอนที่ 2.2 (ฝ่ายจัดส่ง ขั้นตอนที่ 2): ส่งเครื่องไปยังสาขาปลายทาง
// @route   PUT /api/delivery/:id/deliver
exports.courierDeliver = async (req, res) => {
    try {
        const { id } = req.params;
        const { trackingNumber, note } = req.body;

        const transfer = await DeliveryTransfer.findById(id);
        if (!transfer) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการที่ระบุ' });
        }

        // แนบรูปถ่ายหลักฐานตอนฝ่ายจัดส่งส่งเครื่องให้สาขาปลายทางขึ้น Google Drive ทันที
        if (req.file) {
            await handleFileUpload(req, transfer, 'จัดส่งส่งเครื่องถึงปลายทาง');
        }

        // Digital Footprint: courierDeliverSign
        transfer.signatures = transfer.signatures || {};
        transfer.signatures.courierDeliverSign = {
            user: req.user._id,
            name: req.user.name || req.user.username,
            department: req.user.branch || req.user.department || 'ฝ่ายจัดส่ง',
            branch: req.user.branch || '',
            role: req.user.role || '',
            date: new Date()
        };

        // เปลี่ยนสถานะเป็น in_transit (ส่งถึงสาขาปลายทางแล้ว รอสาขาปลายทางตรวจรับเข้าสาขา)
        transfer.status = 'in_transit';

        if (trackingNumber && trackingNumber.trim()) {
            transfer.deliveryProof = transfer.deliveryProof || {};
            transfer.deliveryProof.trackingNumber = trackingNumber.trim();
            transfer.deliveryProof.updatedAt = new Date();
            transfer.deliveryProof.updatedBy = req.user._id;
        }

        if (note && note.trim()) {
            transfer.note = transfer.note 
                ? `${transfer.note}\n[จัดส่งส่งเครื่องไปยังสาขา ${transfer.destinationBranch} โดย ${req.user.name}]: ${note.trim()}` 
                : `[จัดส่งส่งเครื่องไปยังสาขา ${transfer.destinationBranch} โดย ${req.user.name}]: ${note.trim()}`;
        }

        await transfer.save();

        await logActivity(req, 'UPDATE', 'DeliveryTransfer',
            `ฝ่ายจัดส่งส่งเครื่องไปยังสาขาปลายทาง (${transfer.destinationBranch}): "${transfer.title}"`,
            { id: transfer._id, status: transfer.status }
        );

        res.status(200).json({ success: true, message: 'ฝ่ายจัดส่งบันทึกส่งเครื่องไปยังสาขาปลายทางเรียบร้อยแล้ว', data: transfer });
    } catch (error) {
        console.error('courierDeliver Error:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

// @desc    ขั้นตอนที่ 3: แนบหลักฐานการส่งของ (เลขพัสดุ / อัปโหลดรูปภาพลง Google Drive)
// @route   POST /api/delivery/:id/proof
exports.updateDeliveryProof = async (req, res) => {
    try {
        const { id } = req.params;
        const { trackingNumber, note } = req.body;

        const transfer = await DeliveryTransfer.findById(id);
        if (!transfer) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการที่ระบุ' });
        }

        transfer.deliveryProof = transfer.deliveryProof || {};

        if (trackingNumber && trackingNumber.trim()) {
            transfer.deliveryProof.trackingNumber = trackingNumber.trim();
        }

        // อัปโหลดภาพหลักฐานไปยัง Google Drive
        if (req.file) {
            await handleFileUpload(req, transfer, 'อัปเดตหลักฐานส่ง');
        }

        transfer.deliveryProof.updatedAt = new Date();
        transfer.deliveryProof.updatedBy = req.user._id;

        if (note && note.trim()) {
            transfer.note = transfer.note 
                ? `${transfer.note}\n[หลักฐานส่ง]: ${note.trim()}` 
                : `[หลักฐานส่ง]: ${note.trim()}`;
        }

        if (transfer.status === 'ready_to_ship') {
            transfer.status = 'in_transit';
        }

        await transfer.save();

        await logActivity(req, 'UPDATE', 'DeliveryTransfer',
            `อัปเดตหลักฐานจัดส่ง "${transfer.title}" (Tracking: ${transfer.deliveryProof.trackingNumber || '-'})`,
            { id: transfer._id, trackingNumber: transfer.deliveryProof.trackingNumber, proofImageUrl: transfer.deliveryProof.proofImageUrl }
        );

        res.status(200).json({ 
            success: true, 
            message: 'บันทึกหลักฐานการจัดส่งเรียบร้อยแล้ว', 
            data: transfer 
        });
    } catch (error) {
        console.error('updateDeliveryProof Error:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

// @desc    ขั้นตอนที่ 4: สาขาปลายทางลงชื่อรับเครื่องเข้าสาขา (Completed)
// @route   PUT /api/delivery/:id/receive
exports.receiveTransfer = async (req, res) => {
    try {
        const { id } = req.params;
        let { note, conditionStatus, conditionLabel, checklists, itemConditions } = req.body;

        if (typeof checklists === 'string') {
            try { checklists = JSON.parse(checklists); } catch(e) {}
        }
        if (typeof itemConditions === 'string') {
            try { itemConditions = JSON.parse(itemConditions); } catch(e) {}
        }

        const transfer = await DeliveryTransfer.findById(id);
        if (!transfer) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการที่ระบุ' });
        }

        // แนบรูปถ่ายหลักฐานตอนตรวจรับของเข้าสาขาขึ้น Google Drive ทันที
        if (req.file) {
            await handleFileUpload(req, transfer, 'ตรวจรับเข้าสาขา');
        }

        // Digital Footprint: receiverSign
        transfer.signatures = transfer.signatures || {};
        transfer.signatures.receiverSign = {
            user: req.user._id,
            name: req.user.name || req.user.username,
            department: req.user.department || '',
            branch: req.user.branch || transfer.destinationBranch,
            role: req.user.role || '',
            date: new Date()
        };

        transfer.status = 'completed';

        // บันทึกผลการตรวจรับความสมบูรณ์ของสินค้า
        const conditionText = conditionLabel || (conditionStatus === 'perfect' ? 'สมบูรณ์ 100%' : (conditionStatus === 'damaged' ? 'ชำรุด/เสียหาย' : (conditionStatus === 'incomplete' ? 'อุปกรณ์ไม่ครบ' : 'มีตำหนิ')));

        transfer.receivingCondition = {
            status: conditionStatus || 'perfect',
            statusLabel: conditionText,
            checklists: Array.isArray(checklists) ? checklists : [],
            itemConditions: Array.isArray(itemConditions) ? itemConditions : [],
            receivedAt: new Date(),
            receivedBy: req.user._id
        };

        if (note && note.trim()) {
            transfer.note = transfer.note 
                ? `${transfer.note}\n[ตรวจรับเข้าสาขาโดย ${req.user.name} - สภาพ: ${conditionText}]: ${note.trim()}` 
                : `[ตรวจรับเข้าสาขาโดย ${req.user.name} - สภาพ: ${conditionText}]: ${note.trim()}`;
        } else {
            transfer.note = transfer.note 
                ? `${transfer.note}\n[ตรวจรับเข้าสาขาโดย ${req.user.name}]: สภาพ ${conditionText}` 
                : `[ตรวจรับเข้าสาขาโดย ${req.user.name}]: สภาพ ${conditionText}`;
        }

        await transfer.save();

        await logActivity(req, 'UPDATE', 'DeliveryTransfer',
            `สาขา ${transfer.destinationBranch} ลงชื่อรับเครื่องเรียบร้อยแล้ว (สภาพ: ${conditionText}): "${transfer.title}"`,
            { id: transfer._id, status: transfer.status, receivingCondition: transfer.receivingCondition }
        );

        res.status(200).json({ success: true, message: 'ลงชื่อรับเครื่องเข้าสาขาเรียบร้อยแล้ว', data: transfer });
    } catch (error) {
        console.error('receiveTransfer Error:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

// @desc    ยกเลิกรายการจัดส่ง (Cancel)
// @route   DELETE /api/delivery/:id
exports.cancelDeliveryTransfer = async (req, res) => {
    try {
        const transfer = await DeliveryTransfer.findById(req.params.id);
        if (!transfer) {
            return res.status(404).json({ success: false, message: 'ไม่พบรายการที่ระบุ' });
        }

        const isManagement = isManagerOrAdmin(req.user);
        const isOwner = String(transfer.createdBy) === String(req.user._id);

        if (!isManagement && !isOwner) {
            return res.status(403).json({ success: false, message: 'คุณไม่มีสิทธิ์ยกเลิกรายการนี้' });
        }

        if (transfer.status !== 'pending' && !isManagement) {
            return res.status(400).json({ success: false, message: 'สามารถยกเลิกได้เฉพาะรายการที่รอดำเนินการเท่านั้น' });
        }

        transfer.status = 'canceled';
        await transfer.save();

        await logActivity(req, 'DELETE', 'DeliveryTransfer',
            `ยกเลิกรายการจัดส่ง: "${transfer.title}" (${transfer.destinationBranch})`,
            { id: transfer._id }
        );

        res.status(200).json({ success: true, message: 'ยกเลิกรายการจัดส่งเรียบร้อยแล้ว' });
    } catch (error) {
        console.error('cancelDeliveryTransfer Error:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};
