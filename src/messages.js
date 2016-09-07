module.exports = {
    genPing: function () {
        return { type: 'ping' };
    },

    genPong: function () {
        return { type: 'pong' };
    },

    genMessage: function (content) {
        return {
            type: 'message',
            content: content
        };
    },

    genRequest: function (content, reqId) {
        if (reqId == null)
            throw new Error('Sequential number missing in genRequest!');

        return {
            type: 'request',
            reqId: reqId,
            content: content
        };
    },

    genResponse: function (req, content) {
        if (req == null)
            throw new Error('Request not defined in genResponse!');
        
        return {
            type: 'response',
            reqId: req.reqId,
            status: 'ok',
            content: content
        };
    },

    genErrorResponse: function (req, explain) {
        return {
            type: 'response',
            reqId: req.reqId,
            status: 'error',
            content: explain
        }
    }

}
