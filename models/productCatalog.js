const mongoose = require('mongoose');

const ProductCatalogSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('ProductCatalog', ProductCatalogSchema);
