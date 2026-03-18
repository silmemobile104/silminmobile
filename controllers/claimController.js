const Claim = require('../models/claim');
const { logActivity } = require('../utils/logger'); // Activity Log

// @desc    Create new claim
// @route   POST /api/claims
// @access  Private (Sales Staff)
exports.createClaim = async (req, res) => {
    try {
        const {
            transferNumber,
            productName,
            productCode,
            quantity,
            problem,
            supplier
        } = req.body;

        const newClaim = new Claim({
            transferNumber,
            branch: req.user.branch || req.user.department,
            companyId: req.user.companyId,
            createdBy: req.user._id,
            productName,
            productCode,
            quantity,
            problem,
            supplier
        });

        await newClaim.save();
        await logActivity(req, 'CREATE', 'Claim', `แจ้งเคลมใหม่: ${newClaim.productName} (${newClaim.branch})`, { id: newClaim._id, productName: newClaim.productName, branch: newClaim.branch, quantity: newClaim.quantity });
        res.status(201).json(newClaim);
    } catch (error) {
        console.error('Create Claim Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Get claims
// @route   GET /api/claims
// @access  Private
exports.getClaims = async (req, res) => {
    try {
        let query = { companyId: req.user.companyId };

        // Check if user is Stock/Store department (Case insensitive)
        const userDept = (req.user.department || '').toLowerCase();
        const stockKeywords = ['stock', 'store', 'สต๊อก', 'คลัง', 'warehouse', 'supply'];
        const isStockTeam = stockKeywords.some(keyword => userDept.includes(keyword));

        const canViewAll = ['admin', 'manager', 'executive'].includes(req.user.role) || isStockTeam;

        // --- Filters from Query ---
        const { branch, status, search } = req.query;

        // Status Filter
        if (status && status !== 'all') {
            query.status = status;
        }

        // Search Filter (Transfer No, Product Name, Code)
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { transferNumber: searchRegex },
                { productName: searchRegex },
                { productCode: searchRegex },
                { supplier: searchRegex }
            ];
        }

        // Date Filter (Support Range and Single Date)
        const { date, startDate: qStartDate, endDate: qEndDate } = req.query;

        if (qStartDate || qEndDate) {
            query.createdAt = {};
            if (qStartDate) {
                const sDate = new Date(qStartDate);
                sDate.setHours(0, 0, 0, 0);
                query.createdAt.$gte = sDate;
            }
            if (qEndDate) {
                const eDate = new Date(qEndDate);
                eDate.setHours(23, 59, 59, 999);
                query.createdAt.$lte = eDate;
            }
        } else if (date) {
            const sDate = new Date(date);
            sDate.setHours(0, 0, 0, 0);
            const eDate = new Date(date);
            eDate.setHours(23, 59, 59, 999);
            query.createdAt = { $gte: sDate, $lte: eDate };
        }

        // Branch Filter & Permission Logic
        if (req.user.role === 'staff' && !canViewAll) {
            // Staff sees only their branch (Enforced)
            query.branch = req.user.branch;
        } else {
            // Admin/Executive/Stock can filter by branch
            if (branch && branch !== 'all') {
                query.branch = branch;
            }
        }

        const claims = await Claim.find(query)
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: claims.length,
            data: claims
        });
    } catch (error) {
        console.error('Get Claims Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Update claim status (Admin/Manager/Stock)
// @route   PUT /api/claims/:id/status
// @access  Private (Admin/Manager/Stock)
exports.updateClaimStatus = async (req, res) => {
    try {
        const { status, supplier } = req.body;

        // Check Permissions: Admin/Manager OR Stock Team
        const userDept = (req.user.department || '').toLowerCase();
        const stockKeywords = ['stock', 'store', 'สต๊อก', 'คลัง', 'warehouse', 'supply'];
        const isStockTeam = stockKeywords.some(keyword => userDept.includes(keyword));

        const canUpdate = ['admin', 'manager', 'executive'].includes(req.user.role) || isStockTeam;

        console.log(`[DEBUG] UpdateStatus: User=${req.user.username}, Role=${req.user.role}, Dept=${req.user.department} (${userDept})`);
        console.log(`[DEBUG] isStockTeam=${isStockTeam}, canUpdate=${canUpdate}`);

        if (!canUpdate) {
            return res.status(403).json({
                message: `Not authorized to update claim status. Role: ${req.user.role}, Dept: ${req.user.department}`
            });
        }

        const claim = await Claim.findById(req.params.id);

        if (!claim) {
            return res.status(404).json({ message: 'Claim not found' });
        }

        if (status) claim.status = status;
        if (supplier !== undefined) claim.supplier = supplier;
        await claim.save();
        await logActivity(req, 'UPDATE', 'Claim', `อัปเดตสถานะเคลม: ${claim.productName} เป็น "${claim.status}"`, { id: claim._id, status: claim.status, productName: claim.productName });
        res.status(200).json(claim);
    } catch (error) {
        console.error('Update Claim Status Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};
// @desc    Update claim details
// @route   PUT /api/claims/:id
// @access  Private (Creator or Admin/Manager/Stock)
exports.updateClaim = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const claim = await Claim.findById(id);
        if (!claim) {
            return res.status(404).json({ message: 'Claim not found' });
        }

        // Check Permissions: Creator OR Admin/Manager OR Stock Team
        // Note: Sales staff should only edit their own claims
        const userDept = (req.user.department || '').toLowerCase();
        const stockKeywords = ['stock', 'store', 'สต๊อก', 'คลัง', 'warehouse', 'supply'];
        const isStockTeam = stockKeywords.some(keyword => userDept.includes(keyword));
        const isAdminOrManager = ['admin', 'manager', 'executive'].includes(req.user.role);
        const isCreator = claim.createdBy.toString() === req.user._id.toString();

        if (!isCreator && !isAdminOrManager && !isStockTeam) {
            return res.status(403).json({ message: 'Not authorized to update this claim' });
        }

        const updatedClaim = await Claim.findByIdAndUpdate(id, updates, { new: true });
        await logActivity(req, 'UPDATE', 'Claim', `แก้ไขข้อมูลเคลม: ${updatedClaim.productName}`, { id, updates });
        res.status(200).json(updatedClaim);
    } catch (error) {
        console.error('Update Claim Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Delete claim
// @route   DELETE /api/claims/:id
// @access  Private (Creator or Admin/Manager)
exports.deleteClaim = async (req, res) => {
    try {
        const { id } = req.params;

        const claim = await Claim.findById(id);
        if (!claim) {
            return res.status(404).json({ message: 'Claim not found' });
        }

        // Check Permissions
        const userDept = (req.user.department || '').toLowerCase();
        const stockKeywords = ['stock', 'store', 'สต๊อก', 'คลัง', 'warehouse', 'supply'];
        const isStockTeam = stockKeywords.some(keyword => userDept.includes(keyword));
        const isAdminOrManager = ['admin', 'manager', 'executive'].includes(req.user.role);
        const isCreator = claim.createdBy.toString() === req.user._id.toString();

        // Allow creator to delete if status is pending? Or always?
        // Let's allow creator, admin, manager, and stock team to delete.
        if (!isCreator && !isAdminOrManager && !isStockTeam) {
            return res.status(403).json({ message: 'Not authorized to delete this claim' });
        }

        await Claim.findByIdAndDelete(id);
        await logActivity(req, 'DELETE', 'Claim', `ลบรายการเคลม: ${claim.productName} (${claim.branch})`, { id, productName: claim.productName });
        res.status(200).json({ message: 'Claim deleted' });
    } catch (error) {
        console.error('Delete Claim Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};
