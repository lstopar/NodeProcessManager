module.exports = {
    genPing: function () {
        return { type: 'ping' };
    },

    genPong: function () {
        return { type: 'pong' };
    },

    genRequest: function (content, reqN) {
        if (reqN == null)
            throw new Error('Sequential number missing in genRequest!');

        return {
            type: 'request',
            reqN: reqN,
            content: content
        };
    },

    genResponse: function (req, content) {
        if (req == null)
            throw new Error('Request not defined in genResponse!');
        
        return {
            type: 'response',
            reqN: req.reqN,
            status: 'ok',
            content: content
        };
    },

    genErrorResponse: function (req, explain) {
        return {
            type: 'response',
            reqN: req.reqN,
            status: 'error',
            content: explain
        }
    }

}
