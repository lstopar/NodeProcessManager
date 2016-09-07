var messages = require('./messages.js');

const REQUEST_TIMEOUT = 10000;


class SlaveProcess {
    constructor() {
        this.handlers = {
            request: function (msg, cb) { cb(undefined, null); },   // XXX: when no handler is present send an empty response
            message: function (msg) {}
        };

        var self = this;
        process.on('message', (msg) => {
            self._onMessage(msg);
        });
    }

    /**
     * Sends a message to the master.
     *
     * @param {Object} msg - the message
     */
    sendMsg(msg) {
       this._sendMsg(messages.genMessage(msg));
    }

    /**
     * Registers a new event handler.
     *
     * @param {String} event - name of the event, either 'message' or 'request'
     * @param {Function} handler - the event handler. When registering a message handler the function takes one argument: the message,
     * while when registering a request handler the function takes two arguments: the request and the callback
     */
    on(event, handler) {
        if (event != 'request' && event != 'message')
            throw new Error('Unknown event: ' + event);
        this.handlers[event] = handler;
    }

    _sendMsg(msg) {
        console.log('Sending message: ' + JSON.stringify(msg));
        process.send(msg);
    }

    _onMessage(msg) {
        try {
            console.log('Received message in child: ' + JSON.stringify(msg) + ' ...');

            var type = msg.type;
            switch (type) {
                case 'ping': {
                    var pong = messages.genPong();
                    process.send(pong);
                    break;
                }
                case 'request': {
                    var handler = this.handlers.request;

                    try {
                        var self = this;
                        handler(msg.content, (e, res) => {
                            if (e != null) {
                                console.error(e, 'Exception in child process!');
                                self._sendMsg(messages.genErrorResponse(msg, e.message));
                                return;
                            }

                            self._sendMsg(messages.genResponse(msg, res));
                        });
                    } catch (e) {
                        console.error(e, 'Exception while processing request!');
                        self._sendMsg(messages.genErrorResponse(msg, e.message));
                    }
                    break;
                }
                case 'message': {
                    var handler = this.handlers.message;
                    handler(msg.content);
                    break;
                }
                default: {
                    // XXX: if not supported throw an exception for now.
                    throw new Error('Invalid message type: ' + type);
                }
            }

        } catch (e) {
            console.log(e, 'Exception while processing message from parent!');
        }

    }
}

class MasterProcess {
    
    constructor(opts) {
        this.slaveH = {};
        this.messageCb = function () {}
        this.currReqIdH = {};
        this.procReqCbH = {};
        this.closeCb = function () {}
        this.errorCb = function () {}
    }

    /**
     * Registers a new child process or a new array of child processes and returns their IDs.
     * 
     * @param {child_process.ChildProcess|Array<child_process.ChildProcess>} slave(s) - one or more slave processes
     * @param {} [slaveId(s)] - ID (or array of IDs) of the slave
     * @returns slaveId(s)
     */
    register(slave, slaveId) {
        if (Array.isArray(slave)) {
            var slaves = slave;
            var slaveIds = slaveId;

            var ids = [];
            for (var slaveN = 0; slaveN < slaves.length; slaveN++) {
                var id = this.register(slaves[slaveN], slaveIds != null ? slaveIds[slaveN] : undefined);
                ids.push(id);
            }

            return ids;
        }
        else {
            return this._initSlave(slave, slaveId);
        }
    }

    /**
     * Sends an asynchrounous message to one or all of the slaves.
     *
     * @param {Object} content - content of the message
     * @param {Integer} [procN] - the index of the slave
     */
    sendMsg(content, slaveId) {
        var msg = messages.genMessage(content);
        this._sendMsg(msg, slaveId);
    }

    sendRequest(content, slaveId, cb) {
        if (slaveId == null)
            return cb(new Error('Process identifier missing when sending request!'));
        if (!(slaveId in this.slaveH))
            return cb(new Error('Invalid process identifier: ' + slaveId));

        var self = this;

        try {
            var reqId = this._genReqId(slaveId);

            var req = messages.genRequest(content, reqId);
            var handler = function (e, res) {
                try {
                    if (e != null)
                        return cb(e);

                    console.log('Received response from process: ' + slaveId);

                    self._offResponse(slaveId, reqId, handler);
                    cb(undefined, res);
                } catch (e) {
                    console.error(e, 'Exception while processing response!');
                }
            }

            this._onResponse(slaveId, reqId, handler);
            this._sendMsg(req, slaveId);
        } catch (e) {
            cb(e);
        }
    }

    on(event, handler) {
        if (handler == null)
            throw new Error('Handler is null!');

        if (event == 'message') {
            this.messageCb = handler;
        }
        else if (event == 'close') {
            this.closeCb = handler;
        }
        else if (event == 'error') {
            this.errorCb = handler;
        }
        else {
            throw new Error('Invalid event name: ' + event);
        }
    }

    off(event, handler) {
        if (handler == null)
            throw new Error('Handler is null!');

        console.log('Removing handler ...');

        if (event == 'message') {
            this.messageCb = function () {}
        }
        else if (event == 'close') {
            this.closeCb = function () {}
        }
        else if (event == 'error') {
            this.errorCb = function () {}
        }
        else {
            throw new Error('Invalid event: ' + event);
        }
    }

    /*
     * Sends a message to one or all processes.
     *
     * @param {Object} msg - the message to send
     * @param {Integer} [processId] - the ID of the process, if missing the message will be sent to all the processes
     */
    _sendMsg(msg, slaveId) {
        if (slaveId != null) {
            if (!(slaveId in this.slaveH))
                throw new Error('Invalid process ID: ' + slaveId);
            
            console.log('Sending message to slave ' + slaveId + ' ...');
            this.slaveH[slaveId].send(msg);            
        }
        else {
            console.log('Sending message to all slaves ...');
            for (var id in this.slaveH) {
                this._sendMsg(msg, id);
            }
        }
    }

    _onResponse(slaveId, reqId, handler) {
        var procHandlers = this.procReqCbH[slaveId];
        procHandlers[reqId] = {
            handler: handler,
            timestamp: new Date().getTime()
        };
    }

    _offResponse(slaveId, reqId, handler) {
        var procHandlers = this.procReqCbH[slaveId];
        delete procHandlers[reqId];
    }

    _initSlave(slave, slaveId) {
        if (slaveId == null) slaveId = slave.pid;

        this.slaveH[slaveId] = slave;
        this.currReqIdH[slaveId] = 0;
        this.procReqCbH[slaveId] = {};
        
        var self = this;

        slave.on('error', (e) => {
            self._cleanup(slaveId);
            self.errorCb(slaveId, e);
        });

        slave.on('close', (code) => {
            self._cleanup(slaveId);
            self.closeCb(slaveId);
        });

        slave.on('message', (msg) => {
            try {
                console.log('Received message from slave ' + slaveId + ': ' + JSON.stringify(msg) + '...');

                var type = msg.type;

                switch(type) {
                    case 'message': {
                        self.messageCb(slaveId, msg.content);
                        break;
                    }
                    case 'response': {
                        var reqId = msg.reqId;
                        var handlerH = self.procReqCbH[slaveId];
                        
                        if (reqId in handlerH) {
                            var handler = handlerH[reqId].handler;
                            var status = msg.status;

                            if (status == 'error')
                                handler(new Error(msg.content));
                            else
                                handler(undefined, msg.content);
                            
                            // the request has been processed, so remove the handler
                            delete handlerH[reqId];
                        }
                        break;
                    }
                    default: {
                        throw new Error('Unknown message type: ' + type);
                    }
                }

                self._cleanupRespHandlers();
            } catch (e) {
                console.log(e, 'Exception while processing slave message!');
            }
        });

        return slaveId;
    }

    _cleanup(slaveId) {
        var slave = this.slaveH[slaveId];

        delete this.slaveH[slaveId];
        delete this.currReqIdH[slaveId];
        delete this.procReqCbH[slaveId];
    }

    _cleanupRespHandlers() {
        var timestamp = new Date().getTime();
        
        console.log('Cleaning up request handlers ...');

        for (var slaveId in this.procReqCbH) {
            var procHandlers = this.procReqCbH[slaveId];
            for (var reqId in procHandlers) {
                var handlerConf = procHandlers[reqId];
                if (timestamp - handlerConf.timestamp > REQUEST_TIMEOUT) {
                    console.log('Removing handler ' + handlerN + ' of process: ' + procId);

                    handlerConf.handler(new Error('Request timeout!'));
                    delete procHandlers[reqId];
                }
            }
        }
    }

    _genReqId(slaveId) {
        return this.currReqIdH[slaveId]++;
    }
}

exports.slave = function (opts) {
    return new SlaveProcess(opts);
}

exports.master = function (opts) {
    return new MasterProcess(opts);
}
