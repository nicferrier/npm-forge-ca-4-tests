const https = require("https");
const assert = require("assert");

const express = require("express");
const fetch = require("node-fetch");
const cacerts = require("./cacerts.js");

const tls = require("tls");


/**
   This test shows how to control what names are acceptable on the server.

   In *some* circumstances a TLS protected server may want to allow
   localhost access for which it hasn't obtained the certificate.

   This might be for health monitoring or some such, so that
   operational clients don't necessarily have to discover the server's
   certificated name.

   This example shows that control via an agent's
   `checkServerIdentity` function.
 */
const test = async function () {
    // Make a CA and a cert for the router address - fake Internet CA
    const {
        caCert,
        caAttrs,
        caKeyPair,
        issue: internetMakeCert
    } = cacerts.makeCa();

    // Make a CSR with our fake name
    const [privateKeyInPem, publicKeyInPem, csrInPem] = cacerts.makeCsr({
        commonName: "my-host.example.com"
    }, ["www.example.com"]); // Also supply alt names

    const {cert, ca} = internetMakeCert(publicKeyInPem, csrInPem);

    // Start the router
    const tlsOpts = {
        key: privateKeyInPem,
        cert,
        ca,
    };

    const app = express();
    app.get("/", function (req, res) {
        res.send("secure!");
    });

    const server = tlsOpts !== undefined
          ? https.createServer(tlsOpts, app)
          : http.createServer(app);
    const listener = server.listen(0);
    const serverPort = listener.address().port;

    console.log("server port", serverPort);
    
    const caAgent = new https.Agent({
        ca,
        checkServerIdentity: function(host, cert) {
            console.log("check server identity for:", host);
            if (host !== "localhost") {
                const err = tls.checkServerIdentity(host, cert);
                if (err) {
                    // console.log("identity check tls err", err);
                    return err;
                }
            }
        }
    });

    const requestOpts = {
        hostname: "www.example.com",
        port: serverPort,
        path: "/",
        agent: caAgent
    };

    requestOpts.header = {
        host: requestOpts.hostname
    };
    requestOpts.servername = requestOpts.hostname;
    // Now reset the hostname to the loopback
    requestOpts.hostname = "127.0.0.1";

    const [err, response] = await new Promise((resolve, reject) => {
        const req = https.request(requestOpts, function (response) {
            let dataBuf="";
            response.on("data", chunk => dataBuf = dataBuf + new String(chunk, "utf8"));
            response.on("end", _ => resolve({
                status: response.statusCode,
                body: dataBuf
            }));
        });
        req.on("error", reject);
        req.on("tlsClientError", reject);
        req.end();
    }).then(r => [undefined, r]).catch(e => [e]);

    assert.ok(err === undefined);
    assert.ok(response.status === 200);
    assert.ok(response.body === "secure!");

    /*
      And now a request where we're talking to localhost and NOT the
      server's name.

      In ordinary circumstances the request would be rejected with an
      error but because we have a `checkServerIdentity` explicitly
      allowing it, the request will complete successfully.
     */
    const lrequestOpts = {
        hostname: "localhost",
        port: serverPort,
        path: "/",
        agent: caAgent
    };
    lrequestOpts.servername = "localhost";

    const [lerr, lresponse] = await new Promise((resolve, reject) => {
        const req = https.request(lrequestOpts, function (response) {
            let dataBuf="";
            response.on("data", chunk => dataBuf = dataBuf + new String(chunk, "utf8"));
            response.on("end", _ => resolve({
                status: response.statusCode,
                body: dataBuf
            }));
        });
        req.on("error", reject);
        req.on("tlsClientError", reject);
        req.end();
    }).then(r => [undefined, r]).catch(e => [e]);

    assert.ok(lerr === undefined);
    assert.ok(lresponse.status === 200);
    assert.ok(lresponse.body === "secure!");

    /*
      And now proof that it does fail with an invalid name.
     */
    const erequestOpts = {
        hostname: "mail.example.com",
        port: serverPort,
        path: "/",
        agent: caAgent
    };
    lrequestOpts.servername = "mail.example.com";

    const [eerr, eresponse] = await new Promise((resolve, reject) => {
        const req = https.request(lrequestOpts, function (response) {
            let dataBuf="";
            response.on("data", chunk => dataBuf = dataBuf + new String(chunk, "utf8"));
            response.on("end", _ => resolve({
                status: response.statusCode,
                body: dataBuf
            }));
        });
        req.on("error", reject);
        req.on("tlsClientError", reject);
        req.end();
    }).then(r => [undefined, r]).catch(e => [e]);

    assert.ok(eerr !== undefined);
    assert.ok(eerr.message.indexOf("does not match certificate's altnames") > 0);
    listener.close();
};

test().then();

// End
