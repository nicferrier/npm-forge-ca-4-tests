const assert = require("assert");
const https = require("https");
const express = require("express");
const caMaker = require("./cacerts.js");

const test = async function () {
    const { issue } = caMaker.makeCa();
    const [privateKeyInPem, myPublicKeyInPem, csrInPem] = caMaker.makeCsr();
    const {cert, ca} = issue(myPublicKeyInPem, csrInPem);
    
    const app = express();
    app.get("/", function (req, res) { res.send("hello world"); });

    const tlsOpts = { key: privateKeyInPem, cert, ca };

    const listener = https.createServer(tlsOpts, app).listen(8443);
    https.globalAgent = new https.Agent({ ca: ca });

    try {
        const receivedData = await new Promise((resolve, reject) => {
            https.get("https://localhost:8443", { agent: https.globalAgent }, response => {
                let rawData = '';
                response.on('data', (chunk) => { rawData += chunk; });
                response.on('end', () => {
                    try {
                        resolve(rawData);
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            }).end();
            
        });

        // have we got the data from the request to the SSL'd server
        assert.ok(receivedData === "hello world");
        console.log("complete");
    }
    finally {
        listener.close();
    }
};

test().then();

// End
