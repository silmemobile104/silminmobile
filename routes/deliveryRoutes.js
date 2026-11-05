const express = require('express');
const router = express.Router();
const multer = require('multer');
const deliveryController = require('../controllers/deliveryController');
const { protect } = require('../middleware/authMiddleware');

// Multer memory storage for proof image uploads
const storageMemory = multer.memoryStorage();
const uploadMemory = multer({
    storage: storageMemory,
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

// Transfer List, Details & Edit
// Transfer List & Details
router.get('/', protect, deliveryController.getDeliveryTransfers);
router.post('/', protect, deliveryController.createDeliveryTransfer);

// Proxy Google Drive image so it loads reliably in all browsers
router.get('/image/:fileId', deliveryController.getDriveImage);

router.get('/:id', protect, deliveryController.getTransferById);

// Step 1: Branch B prepares, signs & can attach proof photo
router.put('/:id/prepare', protect, uploadMemory.single('proofImage'), deliveryController.acknowledgeAndPrepare);

// Step 2.1: Logistics / Courier Step 1 - pickup from source branch
router.put('/:id/pickup', protect, uploadMemory.single('proofImage'), deliveryController.courierPickup);

// Step 2.2: Logistics / Courier Step 2 - deliver to destination branch
router.put('/:id/deliver', protect, uploadMemory.single('proofImage'), deliveryController.courierDeliver);

// Step 3: Attach delivery proof (Tracking No. and/or Proof Image)
router.post('/:id/proof', protect, uploadMemory.single('proofImage'), deliveryController.updateDeliveryProof);

// Step 4: Branch A receives, signs & can attach proof photo
router.put('/:id/receive', protect, uploadMemory.single('proofImage'), deliveryController.receiveTransfer);

// Edit transfer (any step, can update data and attach/replace proof photo)
router.put('/:id', protect, uploadMemory.single('proofImage'), deliveryController.updateDeliveryTransfer);

// Cancel transfer
router.delete('/:id', protect, deliveryController.cancelDeliveryTransfer);

module.exports = router;
