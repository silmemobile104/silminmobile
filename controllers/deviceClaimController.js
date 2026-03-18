const { google } = require('googleapis');
const path = require('path');
const { logActivity } = require('../utils/logger'); // Activity Log

// Load Service Account Credentials
const keyFile = path.join(process.cwd(), 'splendid-yeti-484510-u9-fb19d01ef226.json');

// Scopes required for writing to Sheets
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Initialize Google Auth
const auth = new google.auth.GoogleAuth({
    keyFile: keyFile,
    scopes: SCOPES,
});

exports.submitDeviceClaim = async (req, res) => {
    try {
        const { staffName, branch, customerId, customerName, contactNumber, secondaryContact, screenPassword, claimCase, product, color, capacity, imei, accessories, inspection, problem, attachedDocuments, timestamp, bank, accountNumber, recorderName, inspectorName, stockRecorderName, payerName, renterName, downPayment, installmentDeduct, defectDeduct, accessoriesDeduct, cancelDeduct, netRefund, returnLocation, arrivalDate, docDate, status, repairReplace, newContract, replacementModel, replacementIMEI } = req.body;

        // --- VALIDATION ---
        if (!customerName || !product) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const spreadsheetId = process.env.DEVICE_CLAIM_SPREADSHEET_ID || '1gHfcV_ThNOp5FFrfWS4Gg6mAKcdeiVwWHikWopNUaPQ';
        const sheets = google.sheets({ version: 'v4', auth });

        const dateObj = new Date(timestamp || Date.now());
        const dateStr = dateObj.toLocaleDateString('th-TH');
        const timeStr = dateObj.toLocaleTimeString('th-TH');

        if (spreadsheetId !== 'PLACEHOLDER_SPREADSHEET_ID') {
            const sheetName = 'การตอบแบบฟอร์ม 1';
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${sheetName}'!A:A`
            });

            const rows = response.data.values || [];
            const nextRow = rows.length + 1;
            const range = `'${sheetName}'!A${nextRow}:AK${nextRow}`;
            const formatDate = (d) => d ? new Date(d).toLocaleDateString('th-TH') : '';

            const rowData = [
                `${dateStr} ${timeStr}`, // 1. วันเวลาที่ทำรายการ
                docDate ? formatDate(docDate) : dateStr, // 2. วันที่ออกเอกสาร
                customerId || '',        // 3. รหัสลูกค้า
                screenPassword || '',    // 4. รหัสหน้าจอ(ถ้ามี)
                claimCase || 'แจ้งเคลม', // 5. กรณี
                branch,                  // 6. สถานที่จัดซ่อม
                problem || '',           // 7. อาการเสียเนื่องจาก
                status || 'รอตรวจสอบ',   // 8. สถานะการจัดซ่อม
                repairReplace || '',     // 9. เคลม / เปลี่ยนเครื่อง
                newContract || '',       // 10. เลขที่สัญญาใหม่
                replacementModel || '',  // 11. รุ่นที่เปลี่ยน
                replacementIMEI || '',   // 12. เลข IMEI ที่เปลี่ยน
                returnLocation || '',    // 13. สถานที่คืน
                formatDate(arrivalDate), // 14. วันที่เครื่องมาถึง บริษัทฯ
                customerName,            // 15. ชื่อ - สกุล
                contactNumber,           // 16. เบอร์หลัก
                secondaryContact || '',  // 17. เบอร์รอง
                product,                 // 18. สินค้า
                color || '',             // 19. สี
                capacity || '',          // 20. ความจุ
                imei,                    // 21. เลข IMEI
                accessories || '',       // 22. อุปกรณ์ที่คืน
                inspection || '',        // 23. การตรวจสอบสินค้า
                attachedDocuments || '', // 24. เอกสารแนบ
                bank || '',              // 25. ธนาคาร
                accountNumber || '',     // 26. เลขที่บัญชี
                downPayment || '',       // 27. เงินดาวน์
                installmentDeduct || '', // 28. หักค่างวด
                defectDeduct || '',      // 29. หักค่าตำหนิ
                accessoriesDeduct || '', // 30. หักค่าอุปกรณ์ไม่ครบ
                cancelDeduct || '',      // 31. หักค่ายกเลิกสัญญา
                netRefund || '',         // 32. ยอดคืนสุทธิ
                recorderName || staffName, // 33. ผู้บันทึกรายการ
                inspectorName || '',     // 34. ผู้ตรวจสอบ/รับของ
                stockRecorderName || '', // 35. ลงสต็อกจำหน่าย
                payerName || '',         // 36. ผู้โอน / จ่ายเงืน
                renterName || ''         // 37. ผู้เช่าซื้อ
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: range,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [rowData]
                }
            });
        }

        res.status(201).json({ message: 'Device claim submitted successfully' });
        // Log after responding (fire-and-forget)
        logActivity(req, 'CREATE', 'DeviceClaim', `ส่งแบฟอร์มแจ้งซ่อมเครื่อง: ${customerName} (${product})`, { customerName, product, imei, branch, claimCase });

    } catch (error) {
        console.error('Error submitting device claim:', error);
        res.status(500).json({ message: 'Failed to submit device claim', error: error.message });
    }
};

exports.getDeviceClaims = async (req, res) => {
    try {
        const spreadsheetId = process.env.DEVICE_CLAIM_SPREADSHEET_ID || '1gHfcV_ThNOp5FFrfWS4Gg6mAKcdeiVwWHikWopNUaPQ';

        // Return empty array for placeholder
        if (spreadsheetId === 'PLACEHOLDER_SPREADSHEET_ID') {
            return res.status(200).json({ data: [] });
        }

        const sheets = google.sheets({ version: 'v4', auth });

        // Fetch data starting from row 2750 to ensure we get recent data and not time out
        // Actually, fetching everything might be slow if there are thousands of rows.
        // Let's assume reasonable volume for now or limit the range.
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "'การตอบแบบฟอร์ม 1'!A2:AS"
        });

        const rows = response.data.values;

        if (!rows || rows.length === 0) {
            return res.status(200).json({ data: [] });
        }

        // Map rows to objects
        const claims = rows.map((row, index) => {
            // Helper to safely get value or empty string
            const get = (idx) => (row[idx] || '').toString().trim();

            // Skip empty rows (check if timestamp or key fields exist)
            if (!get(0) && !get(14)) return null;

            return {
                id: index + 2, // Use row number as ID (Row 1 is header, so Row 2 is index 0 in A2:AK)
                timestamp: get(0),
                docDate: get(1),
                customerId: get(2),
                screenPassword: get(3),
                claimCase: get(4),
                branch: get(5),
                problem: get(6),
                status: get(7),
                repairReplace: get(8),
                newContract: get(9),
                replacementModel: get(10),
                replacementIMEI: get(11),
                returnLocation: get(12),
                arrivalDate: get(13),
                customerName: get(14),
                contactNumber: get(15),
                secondaryContact: get(16),
                product: get(17),
                color: get(18),
                capacity: get(19),
                imei: get(20),
                accessories: get(21),
                inspection: get(22),
                attachedDocuments: get(23),
                bank: get(24),
                accountNumber: get(25),
                downPayment: get(26),
                installmentDeduct: get(27),
                defectDeduct: get(28),
                accessoriesDeduct: get(29),
                cancelDeduct: get(30),
                netRefund: get(31),
                recorderName: get(32),
                inspectorName: get(33),
                stockRecorderName: get(34),
                payerName: get(35),
                renterName: get(36),
                linkPDF: get(37),
                returnReceipt: get(38),
                stockIn: get(39),
                sold: get(40),
                statusAlt: get(41),
                result1: get(42),
                result2: get(43),
                result3: get(44)
            };
        }).filter(item => item !== null).reverse(); // Reverse to show newest first

        res.status(200).json({ data: claims });

    } catch (error) {
        console.error('Error fetching device claims:', error);
        res.status(500).json({ message: 'Failed to fetch device claims', error: error.message });
    }
};

exports.updateDeviceClaim = async (req, res) => {
    try {
        const { id } = req.params; // Row number
        const { staffName, branch, customerId, customerName, contactNumber, secondaryContact, screenPassword, claimCase, product, color, capacity, imei, accessories, inspection, problem, attachedDocuments, timestamp, bank, accountNumber, recorderName, inspectorName, stockRecorderName, payerName, renterName, downPayment, installmentDeduct, defectDeduct, accessoriesDeduct, cancelDeduct, netRefund, returnLocation, arrivalDate, docDate, status, repairReplace, newContract, replacementModel, replacementIMEI, linkPDF, returnReceipt, stockIn, sold, statusAlt, result1, result2, result3 } = req.body;

        const spreadsheetId = process.env.DEVICE_CLAIM_SPREADSHEET_ID || '1gHfcV_ThNOp5FFrfWS4Gg6mAKcdeiVwWHikWopNUaPQ';

        if (spreadsheetId === 'PLACEHOLDER_SPREADSHEET_ID') {
            return res.status(200).json({ message: 'Mock update success' });
        }

        const sheets = google.sheets({ version: 'v4', auth });
        const sheetName = 'การตอบแบบฟอร์ม 1';
        const range = `'${sheetName}'!A${id}:AS${id}`;

        const formatDate = (d) => d ? new Date(d).toLocaleDateString('th-TH') : '';

        const rowData = [
            timestamp,               // 1. วันเวลาที่ทำรายการ (Keep original)
            docDate ? (docDate.includes('/') ? docDate : formatDate(docDate)) : '', // 2. วันที่ออกเอกสาร
            customerId || '',        // 3. รหัสลูกค้า
            screenPassword || '',    // 4. รหัสหน้าจอ(ถ้ามี)
            claimCase || '',         // 5. กรณี
            branch || '',            // 6. สถานที่จัดซ่อม
            problem || '',           // 7. อาการเสียเนื่องจาก
            status || '',            // 8. สถานะการจัดซ่อม
            repairReplace || '',     // 9. เคลม / เปลี่ยนเครื่อง
            newContract || '',       // 10. เลขที่สัญญาใหม่
            replacementModel || '',  // 11. รุ่นที่เปลี่ยน
            replacementIMEI || '',   // 12. เลข IMEI ที่เปลี่ยน
            returnLocation || '',    // 13. สถานที่คืน
            arrivalDate ? (arrivalDate.includes('/') ? arrivalDate : formatDate(arrivalDate)) : '', // 14. วันที่เครื่องมาถึง บริษัทฯ
            customerName || '',      // 15. ชื่อ - สกุล
            contactNumber || '',     // 16. เบอร์หลัก
            secondaryContact || '',  // 17. เบอร์รอง
            product || '',           // 18. สินค้า
            color || '',             // 19. สี
            capacity || '',          // 20. ความจุ
            imei || '',              // 21. เลข IMEI
            accessories || '',       // 22. อุปกรณ์ที่คืน
            inspection || '',        // 23. การตรวจสอบสินค้า
            attachedDocuments || '', // 24. เอกสารแนบ
            bank || '',              // 25. ธนาคาร
            accountNumber || '',     // 26. เลขที่บัญชี
            downPayment || '',       // 27. เงินดาวน์
            installmentDeduct || '', // 28. หักค่างวด
            defectDeduct || '',      // 29. หักค่าตำหนิ
            accessoriesDeduct || '', // 30. หักค่าอุปกรณ์ไม่ครบ
            cancelDeduct || '',      // 31. หักค่ายกเลิกสัญญา
            netRefund || '',         // 32. ยอดคืนสุทธิ
            recorderName || '',      // 33. ผู้บันทึกรายการ
            inspectorName || '',     // 34. ผู้ตรวจสอบ/รับของ
            stockRecorderName || '', // 35. ลงสต็อกจำหน่าย
            payerName || '',         // 36. ผู้โอน / จ่ายเงืน
            renterName || '',        // 37. ผู้เช่าซื้อ
            linkPDF || '',           // 38. LinkPDF
            returnReceipt || '',     // 39. รับเครื่องคืน
            stockIn || '',           // 40. ลงสต็อก
            sold || '',              // 41. จำหน่ายแล้ว
            statusAlt || '',         // 42. สถานะ
            result1 || '',           // 43. ผลการดำเนินการครั้งที่ 1
            result2 || '',           // 44. ผลการดำเนินการครั้งที่ 2
            result3 || ''            // 45. ผลการดำเนินการครั้งที่ 3
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [rowData]
            }
        });

        res.status(200).json({ message: 'Device claim updated successfully' });
        // Log after responding (fire-and-forget)
        logActivity(req, 'UPDATE', 'DeviceClaim', `แก้ไขข้อมูลแจ้งซ่อมเครื่อง: ${customerName} (แถว ${id})`, { rowId: id, customerName, product, status });

    } catch (error) {
        console.error('Error updating device claim:', error);
        res.status(500).json({ message: 'Failed to update device claim', error: error.message });
    }
};
