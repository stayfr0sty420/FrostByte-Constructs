const mongoose = require('mongoose');

const TemplateSchema = new mongoose.Schema(
  {
    templateId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    data: { type: Object, required: true },
    createdBy: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Template', TemplateSchema);

