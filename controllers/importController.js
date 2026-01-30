const ImportRequest = require('../models/importRequest');

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

        const newImport = new ImportRequest({
            type,
            branch: req.user.branch || req.user.department,
            companyId: req.user.companyId,
            createdBy: req.user._id,
            files: files,
            details: parsedDetails
        });

        await newImport.save();
        res.status(201).json(newImport);
    } catch (error) {
        console.error('Create Import Error:', error);
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
            query.branch = req.user.branch;
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

        // 1. Handle Files (Append) - Robustness Fix
        console.log(`DEBUG: Updating import ${req.params.id}. Files before: ${importRequest.files ? importRequest.files.length : 0}`);

        if (req.files && req.files.length > 0) {
            const newFiles = req.files.map(file => file.path);
            const existingFiles = importRequest.files || []; // Safety check
            importRequest.files = [...existingFiles, ...newFiles];

            console.log(`DEBUG: Appended ${newFiles.length} new files. Total: ${importRequest.files.length}`);
        }

        // 2. Handle Details
        let parsedDetails = {};
        if (details) {
            try {
                parsedDetails = JSON.parse(details);
                // Ensure items are structured correctly if present
                if (parsedDetails.items && Array.isArray(parsedDetails.items)) {
                    parsedDetails.items = parsedDetails.items.map(item => ({
                        productName: item.productName || item.name || 'Unknown Item',
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
        res.status(200).json(importRequest);
    } catch (error) {
        console.error('Update Import Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};
