// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';
var dataAccess = require('../../data_access');
var requestHandler = require('../../requestHandler');
var e = require('../../errors');

var logger = require('../../logger').logger;

// Logger
var log = logger.getLogger('StaticParticipantResource');


exports.create = function (req, res, next) {
    var authData = req.authData;

    if (typeof req.body !== 'object' || req.body === null || typeof req.body.name !== 'string' || req.body.name === '') {
        return next(new e.BadRequestError('Invalid request body'));
    }

    if (req.body.options && typeof req.body.options !== 'object') {
        return next(new e.BadRequestError('Invalid staticParticipant option'));
    }
    req.body.options = req.body.options || {};

    var options = req.body.options;
    options.name = req.body.name;
    var optionsCopy = {...options, overlays: options.overlays.map(i=>({...i}))};
    dataAccess.room.createStaticParticipant(authData.service._id, req.params.room, optionsCopy, function(err, result) {
        if (!err && result) {
            log.debug('StaticParticipant created:', req.body.name, 'for service', authData.service.name);
            requestHandler.updateStaticParticipant(req.params.room, result._id.toString(), options, ()=>{});
            res.send(result);

        } else {
            log.info('StaticParticipant creation failed', err ? err.message : options);
            next(err || new e.AppError('Create staticParticipant failed'));
        }
    });
};

exports.get = function (req, res, next) {
    var authData = req.authData;
    dataAccess.room.getStaticParticipant(authData.service._id, req.params.room, req.params.id, function(err, ret) {
        if(err){
            next(err);
        }
        if (!ret) {
            log.info('StaticParticipant ', req.params.id, ' does not exist');
            next(new e.NotFoundError('StaticParticipant not found'));
        } else {
            log.info('Representing ret ', ret._id, 'of service ', authData.service._id);
            if(ret.avatarData && ret.avatarData.data)
                ret.avatarData = ret.avatarData.data.toString('base64');

            if(ret.preview && ret.preview.data)
                ret.preview = ret.preview.data.toString('base64');

            if(ret.overlays)
                ret.overlays.forEach(o => {
                    if(o.imageData && o.imageData.data)
                        o.imageData = o.imageData.data.toString('base64');
                })
            res.send(ret);
        }
    });
};

exports.update = function (req, res, next) {
    var authData = req.authData;
    var obj = req.body;
    obj._id = req.params.id;
    var objCopy = {...obj, overlays: obj.overlays.map(i=>({...i}))};
    dataAccess.room.updateStaticParticipant(authData.service._id, req.params.room, objCopy, function(err, ret) {
        if(err){
            next(err);
        }
        if (!ret) {
            log.info('Room.staticParticipants ', req.params.id, ' update failed: ' + err);
            next(err);
        } else {
            log.info('Updated staticParticipants ', ret._id, 'of room ', req.params.room);
            requestHandler.updateStaticParticipant(req.params.room, ret._id.toString(), obj, ()=>{});
            res.send(ret);
        }
    });
};

exports.delete = function (req, res, next) {
    var authData = req.authData;
    dataAccess.room.deleteStaticParticipant(authData.service._id, req.params.room, req.params.id, function(err, id) {
        if(err){
            next(err);
        }
        if (!id) {
            log.info('Room.staticParticipants ', req.params.id, ' delete failed: ' + err);
            next(err);
        } else {
            log.info('Deleted staticParticipants ', id, 'of room ', req.params.room);
            requestHandler.deleteStaticParticipant(req.params.room, id, ()=>{});
            res.send(id);
        }
    });
};

exports.list = function (req, res, next) {
    var authData = req.authData;
    dataAccess.room.listStaticParticipant(authData.service._id, req.params.room, function(err, ret) {
        if(err){
            next(err);
        }
        if (!ret) {
            log.info('Room.staticParticipants ', req.params.room, ' listing failed: ' + err);
            next(err);
        } else {
            log.info('Listing staticParticipants of room ', req.params.room, ': ', ret);
            res.send(ret);
        }
    });
};
