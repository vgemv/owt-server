
'use strict';
var mongoose = require('mongoose');
var Default = require('./../defaults');
var Room = require('./../model/roomModel');

exports.create = function (image, callback) {
    Room.ImageSchema.create(image, function (err, result) {
        if (err) {
            console.error(err);
            return callback(null);
        }
        callback(result._id);
    });
};
  
exports.get = function(id, callback) {
    Room.ImageSchema.findById(id).lean().exec(callback);
}

exports.delete = function(id, callback) {
    Room.ImageSchema.deleteOne({_id: id}, function(err, ret) {
        if (ret.n === 0) id = null;
        callback(err, id);
    });
}