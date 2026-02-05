const StockRequest = require('../models/stockRequest');
const notificationController = require('./notificationController');

// @desc    Create new stock request
// @route   POST /api/stock-requests
exports.createStockRequest = async (req, res) => {
    try {
        console.log('[CreateStockRequest] Body:', JSON.stringify(req.body, null, 2));
        console.log('[CreateStockRequest] User:', JSON.stringify(req.user, null, 2));

        const { title, items, note } = req.body;

        // 1. Validate Items
        if (!items || !Array.isArray(items) || items.length === 0) {
            console.warn('[CreateStockRequest] No items provided');
            return res.status(400).json({ message: 'กรุณาระบุสินค้าอย่างน้อย 1 รายการ' });
        }

        // 2. Validate User/Branch
        // Fallback: if no branch/department, use 'N/A' or try to derive
        const userBranch = req.user.branch || req.user.department || 'สำนักงานใหญ่';

        // 3. Map Items (Handling 'name' vs 'productName')
        const mappedItems = items.map(item => {
            const pName = item.name || item.productName;
            if (!pName) throw new Error('Product name is missing for an item');
            return {
                productName: pName,
                quantity: Number(item.quantity) || 1
            };
        });

        const newRequest = new StockRequest({
            companyId: req.user.companyId || 'company_1_id', // Fallback for dev
            branch: userBranch,
            title: title || 'รายการแจ้งเบิกสินค้า',
            createdBy: req.user._id || req.user.id, // Support both _id and id
            items: mappedItems,
            note: note || ''
        });

        await newRequest.save();
        console.log('[CreateStockRequest] Success:', newRequest._id);
        res.status(201).json(newRequest);
    } catch (error) {
        console.error('[CreateStockRequest] Critical Error:', error);
        res.status(500).json({
            message: 'Server Error',
            error: error.message
        });
    }
};

// @desc    Get stock requests (for Sales/Requester)
// @route   GET /api/stock-requests
exports.getStockRequests = async (req, res) => {
    try {
        // Filter by Branch (All staff in the same branch see the same requests)
        const userBranch = req.user.branch || req.user.department || 'สำนักงานใหญ่';
        const { status } = req.query;
        let query = {
            companyId: req.user.companyId,
            branch: userBranch
        };
        if (status) query.status = status;

        const requests = await StockRequest.find(query)
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json(requests);
    } catch (error) {
        console.error('Get Stock Requests Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Get all stock requests for management (Purchasing/Admin)
// @route   GET /api/stock-requests/manage
exports.getManageStockRequests = async (req, res) => {
    try {
        let query = { companyId: req.user.companyId };

        const { status, branch } = req.query;
        if (status) query.status = status;
        if (branch) query.branch = branch;

        const requests = await StockRequest.find(query)
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json(requests);
    } catch (error) {
        console.error('Manage Stock Requests Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Update stock request status and arrival date
// @route   PUT /api/stock-requests/:id
exports.updateStockRequest = async (req, res) => {
    try {
        const { status, expectedArrival, trackingNumbers, fulfillmentMethod, title, items, note } = req.body;
        const request = await StockRequest.findById(req.params.id);

        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        // Security Check: Allow Sales and Tech staff to update specific fields
        const userDept = (req.user.department || '').toLowerCase();
        const isAdminOrManager = ['admin', 'manager', 'executive', 'hr'].includes(req.user.role);
        const isStockOrPurchasing = ['purchasing', 'purchase', 'จัดซื้อ', 'stock', 'store', 'คลัง', 'supply'].some(kw => userDept.includes(kw));
        const isTech = ['tech', 'เทคนิค'].some(kw => userDept.includes(kw));
        const isSales = userDept.includes('sales') || userDept.includes('ขาย');

        let allowed = isAdminOrManager || isStockOrPurchasing || isTech;

        if (!allowed) {
            if (isSales) {
                // Sales can ONLY update the status field
                const updateKeys = Object.keys(req.body);
                if (updateKeys.length === 1 && updateKeys[0] === 'status') {
                    allowed = true;
                } else {
                    return res.status(403).json({ message: 'Forbidden: Sales staff can only update the status.' });
                }
            } else {
                return res.status(403).json({ message: 'Forbidden: You do not have permission to update stock requests.' });
            }
        }

        // Standard Status Updates
        if (status) request.status = status;
        if (expectedArrival !== undefined) request.expectedArrivalDate = expectedArrival;
        if (Array.isArray(trackingNumbers)) request.trackingNumbers = trackingNumbers;
        if (fulfillmentMethod) request.fulfillmentMethod = fulfillmentMethod;

        // Content Updates (Title, Items, Note) - Only for Management/Stock
        if (isAdminOrManager || isStockOrPurchasing) {
            if (title) request.title = title;
            if (note !== undefined) request.note = note;
            if (items && Array.isArray(items)) {
                request.items = items.map(item => ({
                    productName: item.name || item.productName,
                    quantity: Number(item.quantity) || 1,
                    isTech: item.isTech === true
                }));
            }
        }

        await request.save();

        // Send Notification if status changed to 'shipped'
        if (status === 'shipped' && request.createdBy) {
            const message = `รายการแจ้งเบิก "${request.title}" ของคุณถูกจัดส่งแล้ว (เลขพัสดุ: ${request.trackingNumbers.join(', ') || '-'})`;
            await notificationController.createNotification(
                [request.createdBy],
                message,
                null, // No task ID
                req.user._id || req.user.id
            );
        }

        res.status(200).json(request);
    } catch (error) {
        console.error('Update Stock Request Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Delete stock request
// @route   DELETE /api/stock-requests/:id
exports.deleteStockRequest = async (req, res) => {
    try {
        const request = await StockRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: 'Request not found' });

        // Check Permissions
        const userDept = (req.user.department || '').toLowerCase();
        const stockKeywords = ['stock', 'store', 'สต๊อก', 'คลัง', 'supply', 'purchasing', 'จัดซื้อ'];
        const isStockOrPurchasing = stockKeywords.some(keyword => userDept.includes(keyword));
        const isAdminOrManager = ['admin', 'manager', 'executive'].includes(req.user.role);

        const canForceDelete = isAdminOrManager || isStockOrPurchasing;

        // Only allow deleting pending requests unless admin/manager/stock
        if (request.status !== 'pending' && !canForceDelete) {
            return res.status(403).json({ message: 'Can only delete pending requests' });
        }

        await request.deleteOne();
        res.status(200).json({ message: 'Request removed' });
    } catch (error) {
        console.error('Delete Stock Request Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};
