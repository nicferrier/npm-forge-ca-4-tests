const https = require("https");
const express = require("express");
const caMaker = require("./cacerts.js");
const url = require("url");
const fetch = require("node-fetch");

// These two for the server to do resolution test
const dns = require('dns');
const dns2 = require("dns2");

const service = async function (options= {}) {
    const {
        certServerPort=8443,
        certificateObjectKeyName="pkcs12",
        privateKeyPasswordObjectKeyName="pkcs12password",
        certificateAuthorityObjectKeyName="ca"
    } = options;
    // Make a dns server
    const dnsServer = dns2.createServer((request, send) =>{
        const query = request.questions[0].name;
        const response = new dns2.Packet(request);
        
        // Send an address response
        response.header.qr = 1;
        response.header.ra = 1;
        response.answers.push({
            name: query,
            address: '127.0.0.1',
            type: dns2.Packet.TYPE.A,
            class: dns2.Packet.CLASS.IN,
            ttl: 300
        });
        send(response);
    })
    const dnslistener = await dnsServer.listen(0);
    await new Promise((resolve, reject) => setTimeout(resolve, 2000));
    const dnsServerPort = dnsServer.address().port;

    const resolver = new dns.Resolver();
    resolver.setServers([`127.0.0.1:${dnsServerPort}`]);

    // Make the CA
    const { caCert, caAttrs, caKeyPair, issue } = caMaker.makeCa();

    // Make a CSR for our Cert Server ...
    const [privateKeyInPem, myPublicKeyInPem, csrInPem] = caMaker.makeCsr();
    // ... and issue the cert for the cert server.
    const {cert, ca} = issue(myPublicKeyInPem, csrInPem);

    const app = express();
    app.get("/certificates", async function (req, res) {
        const requestIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const ip = requestIp === "::1" ? "127.0.0.1" : requestIp;

        // Get the dnsName for the cert from the request
        const dnsName = req.query["domain"];

        const [err, resolved] = await new Promise((resolve, reject) => {
            console.log(`cert server dns check for ${dnsName} resolving via> ${dnsServerPort}`);
            resolver.resolve4(dnsName, (err, addresses) => {
                if (err !== null) {
                    reject(err);
                }
                else {
                    resolve(addresses);
                }
            });
        }).then(a => {return [undefined, a]}).catch(e => { return [e]});

        if (err !== undefined) {
            return res.sendStatus(403);
        }

        // Handle any IPv6 nonsense
        const ipv4 = ip.split(":").reverse()[0];
        if (resolved.includes(ipv4)) {
            const altNames = [dnsName];
            const [
                myPrivateKeyInPem,
                myPublicKeyInPem,
                csrInPem
            ] = caMaker.makeCsr({}, altNames);
            // ... and issue the cert for the cert server.
            const { cert, ca, getPkcs12 } = issue(myPublicKeyInPem, csrInPem);

            if (req.query.version === "2") {
                const {pkcs12, pkcs12password} = getPkcs12(myPrivateKeyInPem);
                return res.json({
                    [certificateObjectKeyName]: pkcs12,
                    [privateKeyPasswordObjectKeyName]: pkcs12password,
                    [certificateAuthorityObjectKeyName]: ca
                });
            }

            // Else return version 1
            return res.json({
                privateKey: privateKeyInPem,
                cert,
                ca
            });
        }
        else {
            console.log("simple-cert-server - your server wasn't in the DNS");
            // Your server wasn't listed in the DNS
            res.sendStatus(402);
        }
    });

    const tlsOpts = { key: privateKeyInPem, cert, ca };
    const listener = https.createServer(tlsOpts, app).listen(certServerPort);
    return {
        listener,
        dnsServer,
        port: certServerPort,
        ca
    };
}

module.exports = service;

// End
