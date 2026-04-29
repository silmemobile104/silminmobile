// config/db.js (เวอร์ชันอัปเดต - แก้ Warning)

const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        // ใน Mongoose v6+ ไม่ต้องใส่ options แล้ว
        await mongoose.connect(process.env.MONGO_URI);

        console.log('MongoDB เชื่อมต่อสำเร็จ!');

        try {
            const ProductCatalog = require('../models/productCatalog');
            const initialProducts = [
                '13 128 ดำ New',
                '13 128 ขาว New',
                '15 128 ดำ New',
                '15 128 บลู New',
                '15 128 ชมพู New',
                '15 256 บลู New',
                '16 128 ดำ New',
                '16 128 บลู New',
                '16 128 ชมพู New',
                '16 128 เขียว New',
                '16 128 ขาว New',
                '16 256 บลู New',
                '16 Plus 128 ดำ New',
                '16 Plus 128 ชมพู New',
                '16 Plus 128 ขาว New',
                '16 Pro 128 ดำ New',
                '16p 128 ดำ New',
                '16p 128 Graphite',
                '16pm 256 ดำ New',
                '16 Pro Max 256 Desert',
                '16 Pro Max 256 Desert Titanium',
                '16 Pro Max 256 Graphite',
                '16 Pro Max 256 Silver',
                '16 Pro Max 256 White Titanium',
                '17 256 ดำ New',
                '17 256 บลู New',
                '17 256 ม่วง New',
                '17 256 ขาว New',
                '17 256 เขียว New',
                '17 Pro 256 ขาว New',
                '17 Pro 256 ส้ม New',
                '17 Pro 256 บลู New',
                '17pm 256 บลู New',
                '17pm 256 ส้ม New',
                '17pm 256 ขาว New',
                'iPad Gen11 128 ขาว New',
                'iPad Gen11 128 บลู New',
                'iPad Gen11 128 ชมพู New',
                'iPad Air7 128 ขาว New',
                'iPad Air7 128 ม่วง New',
                'iPad Air7 128 เทา New',
                'iPad Air7 128 บลู New',
                '14 128 บลู New',
                '14 128 ขาว New',
                '14 128 ดำ New',
                '16 pro max ดำ มือ2',
                '13 128 ขาว มือ2',
                '13 128 ชมพู มือ2',
                '13 128 ดำ มือ2 LL',
                '13 128 ดำ มือ2 ZP'
            ];

            const ops = initialProducts
                .map(n => (n || '').trim())
                .filter(Boolean)
                .map(name => ({
                    updateOne: {
                        filter: { name },
                        update: { $setOnInsert: { name } },
                        upsert: true
                    }
                }));

            if (ops.length > 0) {
                const result = await ProductCatalog.bulkWrite(ops, { ordered: false });
                const upserted = result?.upsertedCount || 0;
                console.log(`ProductCatalog seed ensured: ${ops.length} items (new: ${upserted})`);
            }
        } catch (e) {
            console.log('ProductCatalog seed skipped:', e.message);
        }

        // DEBUG
        try {
            const User = require('../models/user');
            const ImportRequest = require('../models/importRequest');
            const admin = await User.findOne({ username: 'admin' });
            console.log('DEBUG: Admin:', admin ? `${admin.username} (${admin.companyId}, ${admin.role})` : 'Not found');
            const imports = await ImportRequest.find({});
            console.log('DEBUG: Imports Count:', imports.length);
            imports.forEach(i => console.log(`DEBUG: Import ${i._id}: Company=${i.companyId}, Type=${i.type}, Branch=${i.branch}`));
        } catch (e) {
            console.log('DEBUG ERROR:', e);
        }
    } catch (err) {
        console.error('MongoDB เชื่อมต่อล้มเหลว:', err.message);
        process.exit(1);
    }
};

module.exports = connectDB;