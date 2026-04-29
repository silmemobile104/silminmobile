const ImportRequest = require('../models/importRequest');
const { logActivity } = require('../utils/logger'); // Activity Log
const ProductCatalog = require('../models/productCatalog');
const xlsx = require('xlsx');

const upsertProductCatalogNames = async (names = []) => {
    const uniqueNames = [...new Set(
        (names || [])
            .map(n => (n || '').trim())
            .filter(Boolean)
    )];

    if (uniqueNames.length === 0) return;

    await Promise.all(uniqueNames.map(name =>
        ProductCatalog.updateOne(
            { name },
            { $setOnInsert: { name } },
            { upsert: true }
        )
    ));
};

// @desc    Create new import request (Phone or Accessory)
exports.createImport = async (req, res) => {
    try {
        const { type, details } = req.body;
        console.log('DEBUG: Received Create Import:', { type, detailsRaw: details }); // (*** DEBUG ***)

        const files = req.files ? req.files.map(file => file.path) : [];
        let parsedDetails = {};
        if (details) {
            try {
                parsedDetails = JSON.parse(details);
                console.log('DEBUG: Parsed Details:', JSON.stringify(parsedDetails, null, 2));

                // (*** Robustness Fix: Ensure items are structured correctly ***)
                if (parsedDetails.items && Array.isArray(parsedDetails.items)) {
                    parsedDetails.items = parsedDetails.items.map(item => ({
                        productName: item.productName || item.name || 'Unknown Item',
                        imei: item.imei || item.IMEI || item.serial || '',
                        quantity: Number(item.quantity || item.qty || 1),
                        note: item.note || item.desc || ''
                    }));
                }

            } catch (e) {
                console.error('DEBUG: Parse Error:', e);
                parsedDetails = details;
            }
        } else {
            // Construct details from individual body fields (for Accessory)
            parsedDetails = {
                productName: req.body.name,
                quantity: req.body.quantity,
                importDate: req.body.importDate,
                description: req.body.description // (*** เพิ่ม: Description for Accessory ***)
            };
        }

        // (*** เพิ่ม: รับ description และ supplier สำหรับ Phone Import ***)
        if (type === 'phone') {
            if (req.body.description) parsedDetails.description = req.body.description;
            if (req.body.supplier) parsedDetails.supplier = req.body.supplier; // (*** Fix: Save Supplier ***)
        }

        if (parsedDetails.items && Array.isArray(parsedDetails.items)) {
            await upsertProductCatalogNames(parsedDetails.items.map(i => i.productName));
        }

        const newImport = new ImportRequest({
            type,
            branch: req.user.branch || req.user.department,
            companyId: req.user.companyId,
            createdBy: req.user._id,
            files: files,
            details: parsedDetails
        });

        await newImport.save();
        const importTypeName = type === 'phone' ? 'โทรศัพท์' : 'อุปกรณ์';
        await logActivity(req, 'CREATE', 'Import', `นำเข้าสินค้า (${importTypeName}) สาขา: ${newImport.branch}`, { id: newImport._id, type, branch: newImport.branch });
        res.status(201).json(newImport);
    } catch (error) {
        console.error('Create Import Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Get product catalog
exports.getProductCatalog = async (req, res) => {
    try {
        const items = await ProductCatalog.find({}, { name: 1 }).sort({ name: 1 });
        res.status(200).json({ success: true, data: items });
    } catch (error) {
        console.error('Get Product Catalog Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Get import requests (with Pagination & Search)
exports.getImports = async (req, res) => {
    try {
        const keepingRoles = ['admin', 'manager', 'executive'];
        const isStock = (req.user.department || '').includes('Store') ||
            (req.user.department || '').includes('Stock') ||
            (req.user.department || '').includes('สต๊อก');

        let query = { companyId: req.user.companyId };

        // 1. Filters
        if (req.query.type) {
            if (req.query.type === 'accessory' || req.query.type === 'accessories') {
                query.type = { $in: ['accessory', 'accessories'] };
            } else {
                query.type = req.query.type;
            }
        }
        if (req.query.branch && req.query.branch !== 'all') {
            query.branch = req.query.branch;
        }
        if (req.query.status && req.query.status !== 'all') {
            query.status = req.query.status;
        }

        // 2. Date Filter
        if (req.query.startDate || req.query.endDate) {
            query.createdAt = {};
            if (req.query.startDate) {
                const start = new Date(req.query.startDate);
                start.setHours(0, 0, 0, 0);
                query.createdAt.$gte = start;
            }
            if (req.query.endDate) {
                const end = new Date(req.query.endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        // 3. Role-based access
        if (req.user.role === 'staff' && !isStock) {
            query.$or = [
                { branch: req.user.branch },
                { createdBy: req.user._id }
            ];
        }

        // 4. Pagination
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20; // Default 20
        const startIndex = (page - 1) * limit;

        const total = await ImportRequest.countDocuments(query);

        const imports = await ImportRequest.find(query)
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 })
            .skip(startIndex)
            .limit(limit);

        res.status(200).json({
            success: true,
            count: imports.length,
            total,
            page,
            totalPages: Math.ceil(total / limit),
            data: imports
        });

    } catch (error) {
        console.error('Get Imports Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Export single import request to Excel
// @route   GET /api/imports/:id/export
exports.exportImportToExcel = async (req, res) => {
    try {
        const xlsxStyle = require('xlsx-js-style');

        const importRequest = await ImportRequest.findById(req.params.id)
            .populate('createdBy', 'name');

        if (!importRequest) {
            return res.status(404).json({ message: 'Import request not found' });
        }

        const details = importRequest.details || {};
        const items = Array.isArray(details.items) && details.items.length > 0
            ? details.items
            : [{
                productName: details.productName || '',
                imei: '',
                quantity: details.quantity || 0,
                note: ''
            }];

        // Prepare Excel data
        const headerRows = [
            ['รายงานการนำเข้าสินค้า'],
            [''],
            ['ข้อมูลบิล'],
            ['ประเภท', importRequest.type || ''],
            ['สาขา', importRequest.branch || ''],
            ['วันที่แจ้ง', importRequest.createdAt ? new Date(importRequest.createdAt).toLocaleDateString('th-TH') : ''],
            ['ผู้แจ้ง', importRequest.createdBy?.name || ''],
            ['Supplier', details.supplier || ''],
            ['รายละเอียด/หมายเหตุ', details.description || ''],
            [''],
            ['รายการสินค้า'],
            ['ลำดับ', 'ชื่อสินค้า', 'IMEI', 'จำนวน', 'หมายเหตุ']
        ];

        const itemRows = items.map((item, index) => [
            index + 1,
            item.productName || '',
            item.imei || '',
            item.quantity || 0,
            item.note || ''
        ]);

        const allRows = [...headerRows, ...itemRows];

        // Create worksheet
        const ws = xlsxStyle.utils.aoa_to_sheet(allRows);

        // Set column widths
        ws['!cols'] = [
            { wch: 8 },   // ลำดับ
            { wch: 30 },  // ชื่อสินค้า
            { wch: 20 },  // IMEI
            { wch: 10 },  // จำนวน
            { wch: 30 }   // หมายเหตุ
        ];

        // Apply "Angsana New" font to all cells
        const defaultFont = { name: 'Angsana New', sz: 14 };
        const boldFont = { name: 'Angsana New', sz: 14, bold: true };
        const titleFont = { name: 'Angsana New', sz: 18, bold: true };

        // Title row (row 0)
        const titleRowIndex = 0;
        // Info label rows (rows 2-8): column A is bold
        const infoLabelRows = [2, 3, 4, 5, 6, 7, 8];
        // Table header row (row 11)
        const tableHeaderRowIndex = 11;

        const range = xlsxStyle.utils.decode_range(ws['!ref']);
        for (let R = range.s.r; R <= range.e.r; R++) {
            for (let C = range.s.c; C <= range.e.c; C++) {
                const cellRef = xlsxStyle.utils.encode_cell({ r: R, c: C });
                if (!ws[cellRef]) continue;

                let font = { ...defaultFont };
                if (R === titleRowIndex) {
                    font = { ...titleFont };
                } else if (R === tableHeaderRowIndex) {
                    font = { ...boldFont };
                } else if (infoLabelRows.includes(R) && C === 0) {
                    font = { ...boldFont };
                } else if (R === 2 || R === 10) {
                    // "ข้อมูลบิล" and "รายการสินค้า" section headers
                    font = { ...boldFont, sz: 16 };
                }

                ws[cellRef].s = {
                    ...(ws[cellRef].s || {}),
                    font: font
                };
            }
        }

        // Create workbook
        const wb = xlsxStyle.utils.book_new();
        xlsxStyle.utils.book_append_sheet(wb, ws, 'Import Report');

        // Generate buffer
        const buffer = xlsxStyle.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Set filename
        const billName = details.billName || importRequest._id;
        const fileName = `Import_Report_${billName}.xlsx`;

        // Send response
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.status(200).send(buffer);
    } catch (error) {
        console.error('Export Import to Excel Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Update status (for Stock/Admin)
exports.updateImportStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const importRequest = await ImportRequest.findById(req.params.id);

        if (!importRequest) {
            return res.status(404).json({ message: 'Request not found' });
        }

        importRequest.status = status;
        await importRequest.save();
        await logActivity(req, 'UPDATE', 'Import', `อัปเดตสถานะนำเข้าเป็น "${status}"`, { id: req.params.id, status });
        res.status(200).json(importRequest);
    } catch (error) {
        console.error('Update Import Status Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};


// @desc    Delete import request
exports.deleteImport = async (req, res) => {
    try {
        // console.log(`DEBUG: Attempting to delete import: ${req.params.id} by user: ${req.user.username} (${req.user.role})`);
        const importRequest = await ImportRequest.findById(req.params.id);

        if (!importRequest) {
            return res.status(404).json({ message: 'Request not found' });
        }

        // Check permissions: Staff can only delete their own branch's requests UNLESS they are Stock department
        const dept = (req.user.department || '').toLowerCase();
        const isStock = dept.includes('store') ||
            dept.includes('stock') ||
            dept.includes('สต๊อก');

        if (req.user.role === 'staff' && !isStock) {
            if (importRequest.branch !== req.user.branch) {
                return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ลบรายการของสาขาอื่น' });
            }
        }

        await importRequest.deleteOne();
        await logActivity(req, 'DELETE', 'Import', `ลบรายการนำเข้า (${importRequest.type}) สาขา: ${importRequest.branch}`, { id: req.params.id, type: importRequest.type });
        res.status(200).json({ message: 'Import request removed' });
    } catch (error) {
        console.error('Delete Import Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};
// @desc    Update import request (Append files & update details)
exports.updateImport = async (req, res) => {
    try {
        const importRequest = await ImportRequest.findById(req.params.id);

        if (!importRequest) {
            return res.status(404).json({ message: 'Request not found' });
        }

        // Check permissions: Staff can only update their own branch's requests UNLESS they are Stock department
        const dept = (req.user.department || '').toLowerCase();
        const isStock = dept.includes('store') ||
            dept.includes('stock') ||
            dept.includes('สต๊อก');

        if (req.user.role === 'staff' && !isStock) {
            if (importRequest.branch !== req.user.branch) {
                return res.status(403).json({ message: 'คุณไม่มีสิทธิ์แก้ไขรายการของสาขาอื่น' });
            }
        }

        const { type, details, supplier, description } = req.body;

        // 1. Keep existing files unchanged on update
        console.log(`DEBUG: Updating import ${req.params.id}. Keeping existing files unchanged. Existing: ${importRequest.files ? importRequest.files.length : 0}`);

        // 2. Handle Details
        let parsedDetails = {};
        if (details) {
            try {
                parsedDetails = JSON.parse(details);
                // Ensure items are structured correctly if present
                if (parsedDetails.items && Array.isArray(parsedDetails.items)) {
                    parsedDetails.items = parsedDetails.items.map(item => ({
                        productName: item.productName || item.name || 'Unknown Item',
                        imei: item.imei || item.IMEI || item.serial || '',
                        quantity: Number(item.quantity || item.qty || 1),
                        note: item.note || item.desc || ''
                    }));
                }
            } catch (e) {
                console.error('DEBUG: Update Parse Error:', e);
                parsedDetails = details;
            }
        } else {
            // Accessory fallback or direct fields
            parsedDetails = {
                productName: req.body.name || importRequest.details.productName,
                quantity: req.body.quantity || importRequest.details.quantity,
                importDate: req.body.importDate || importRequest.details.importDate,
                description: description || req.body.description || importRequest.details.description
            };
        }

        // Phone specific updates
        if (importRequest.type === 'phone' || type === 'phone') {
            if (description) parsedDetails.description = description;
            if (supplier) parsedDetails.supplier = supplier;
        }

        // Update the document
        importRequest.details = { ...importRequest.details, ...parsedDetails };

        // Mark details as modified for Mongoose if nested
        importRequest.markModified('details');

        await importRequest.save();
        await logActivity(req, 'UPDATE', 'Import', `แก้ไขรายการนำเข้า (${importRequest.type})`, { id: req.params.id, type: importRequest.type });
        res.status(200).json(importRequest);
    } catch (error) {
        console.error('Update Import Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};
