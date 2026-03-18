const BranchStockOrder = require('../models/branchStockOrder');
const User = require('../models/user');
const { logActivity } = require('../utils/logger'); // Activity Log

// Create a new order (Purchasing only)
exports.createOrder = async (req, res) => {
    try {
        const { orderDate, expectedDate, orderName, items, branch } = req.body;

        // Ensure user is authorized (Purchasing or Admin) - Though middleware handles role, we double check intent
        // Just standard creation
        const newOrder = new BranchStockOrder({
            orderDate,
            expectedDate,
            orderName,
            items, // Array of { productName, quantity }
            branch,
            createdBy: req.user.id,
            companyId: req.user.companyId || 'company_1_id' // Fallback if undefined, but should be there
        });

        await newOrder.save();
        await logActivity(req, 'CREATE', 'BranchStockOrder', `สร้างคำสั่งซื้อสาขา: ${newOrder.orderName || '-'} (${newOrder.branch})`, { id: newOrder._id, orderName: newOrder.orderName, branch: newOrder.branch });
        res.status(201).json(newOrder);
    } catch (err) {
        console.error('Error creating branch order:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get orders (Purchasing sees all, Branch/Sales sees only their branch)
exports.getOrders = async (req, res) => {
    try {
        const { branch, startDate, endDate, status } = req.query;
        let query = { companyId: req.user.companyId || 'company_1_id' }; // Multi-tenant basic support

        // Role-based access control
        // If user is NOT Purchasing/Admin, restrict to their branch
        // Assuming 'purchasing' is a department or user role. 
        // User roles: 'executive', 'manager', 'hr', 'staff'
        // User department: We need to check department. 
        // Let's assume 'Purchasing' is a department name or we rely on the implementation plan's assumption.
        // For now, I'll filter by user's branch if they have one assigned and are NOT management.

        // However, the request says "Purchasing Department".
        // Let's assume users in "Purchasing" department can see all.
        // And 'Sales' users (User.department = 'Sales' or similar with User.branch set) see only their branch.

        const user = await User.findById(req.user.id);

        // Logic: If user has a specific branch assigned AND is NOT in a central role (like Purchasing/Executive), filter by that branch.
        // Or if the user explicitely requests a filter (and is allowed to).

        if (user.branch && user.department !== 'Purchasing' && user.role !== 'executive' && user.role !== 'manager' && user.role !== 'hr') {
            // Force filter by user's branch for normal staff
            query.branch = user.branch;
        } else {
            // For Purchasing/Manager, if they sent a branch filter, use it
            if (branch && branch !== 'all') {
                query.branch = branch;
            }
        }

        // Date Filter (using expectedDate or orderDate? usually expectedDate for "When will it arrive")
        if (startDate || endDate) {
            query.expectedDate = {};
            if (startDate) query.expectedDate.$gte = new Date(startDate);
            if (endDate) query.expectedDate.$lte = new Date(endDate);
        }

        if (status && status !== 'all') {
            query.status = status;
        }

        const orders = await BranchStockOrder.find(query).sort({ custom_sort: -1, createdAt: -1 }); // sort logic can be improved
        res.json(orders);
    } catch (err) {
        console.error('Error fetching branch orders:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update order (e.g. status) - Optional for now but good to have
exports.updateOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        console.log(`[DEBUG] Received update request for order ${id}:`, updates);

        // Security: Check if user is allowed to update (Purchasing or Manager or Sales for status only)
        const user = await User.findById(req.user.id);
        const userDept = (user.department || '').toLowerCase();
        const isPurchasing = userDept.includes('purchasing') || userDept.includes('purchase') || userDept.includes('จัดซื้อ');
        const isSales = userDept.includes('sales') || userDept.includes('ขาย');

        let allowed = isPurchasing || user.role === 'executive' || user.role === 'manager' || user.role === 'hr';

        if (!allowed) {
            if (isSales) {
                // Sales can ONLY update the status field
                const updateKeys = Object.keys(updates);
                if (updateKeys.length === 1 && updateKeys[0] === 'status') {
                    allowed = true;
                } else {
                    return res.status(403).json({ message: 'Forbidden: Sales staff can only update the status.' });
                }
            } else {
                return res.status(403).json({ message: 'Forbidden: You do not have permission to update orders.' });
            }
        }

        const order = await BranchStockOrder.findByIdAndUpdate(id, updates, { new: true });
        if (!order) {
            console.log(`[DEBUG] Order ${id} not found`);
            return res.status(404).json({ message: 'Order not found' });
        }

        console.log(`[DEBUG] Order ${id} updated successfully:`, order.status);
        await logActivity(req, 'UPDATE', 'BranchStockOrder', `อัปเดตคำสั่งซื้อ: ${order.orderName || id}`, { id, updates });
        res.json(order);
    } catch (err) {
        console.error(`[DEBUG] Error updating order ${id}:`, err);
        res.status(500).json({ message: 'Server error: ' + err.message });
    }
};

// Delete order
exports.deleteOrder = async (req, res) => {
    try {
        const { id } = req.params;

        // Security Check
        const user = await User.findById(req.user.id);
        const userDept = (user.department || '').toLowerCase();
        const isPurchasing = userDept.includes('purchasing') || userDept.includes('purchase') || userDept.includes('จัดซื้อ');

        if (!isPurchasing && user.role !== 'executive' && user.role !== 'manager' && user.role !== 'hr') {
            return res.status(403).json({ message: 'Forbidden' });
        }

        await BranchStockOrder.findByIdAndDelete(id);
        await logActivity(req, 'DELETE', 'BranchStockOrder', `ลบคำสั่งซื้อสาขา ID: ${id}`, { id });
        res.json({ message: 'Order deleted' });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};
