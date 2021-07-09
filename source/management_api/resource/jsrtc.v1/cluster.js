// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';
// var dataAccess = require('../../data_access');
var requestHandler = require('../../requestHandler');
// var e = require('../../errors');

var logger = require('../../logger').logger;

// Logger
// var log = logger.getLogger('Usage');


exports.nodes = function (req, res, next) {
    requestHandler.clusterAllNodes((ret)=>{
        res.send(ret);
    });
}