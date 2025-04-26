const pki = require("node-forge").pki;
const pkcs12 = require("node-forge").pkcs12;
const asn1 = require("node-forge").asn1;
const util = require("node-forge").util;
const md = require("node-forge").md;


// options that we use to make a ca:
//
// serialNumber       -- the starting serial number
//                    
// commonName         -- the common name to be used
//                    
// countryName        -- eg: GB
//                    
// localityName       -- eg: GB
//
// organizatiuonName  -- eg: ""
//
// OU                 -- eg: "test"
//
// options that we use to rebuild a ca from outside data:
//
// certificate        -- the CA cert read in from a pem like:
//
//    pki.certificateFromPem(caCertText, false, true)
//
// privateKey         -- the private key of the CA read in from PEM
//
// publicKey          -- the public key of the CA read in from  PEM
const makeCa = function (options) {
    let serial = options?.serialNumber??1;
    const serialNumber = (function () {
        return function() {
            serial = serial + 1;
            const serialString = "" + serial;
            return serialString.padStart(5, ""); // Not fantastic but enough for in memory ca
        }
    })();

    const {
        caStore,
        caAttrs,
        certificate: caCert,
        privateKey: caPrivateKey,
        publicKey: caPublicKey
    } = options?.certificate
          ? (function () {
              const caAttrs = [
                  {name: "commonName", value: options?.commonName??"example-ca.org"},
                  {name: "countryName", value: options?.countryName??"GB"},
                  {name: "localityName", value: options?.localityName??"GB"},
                  {name: "organizationName", value: options?.organizationName??""},
                  {shortName: "OU", value: options?.OU??"test"}
              ];
              const decorated = Object.assign(options, {caAttrs});
              return decorated;
          })()
          : (function () {
              const caKeyPair = pki.rsa.generateKeyPair(2048);
              const caPublicKey = caKeyPair.publicKey;
              const caPrivateKey = caKeyPair.privateKey;
              const cert = pki.createCertificate();
              cert.publicKey = caPublicKey;
              cert.serialNumber = serialNumber();
              cert.validity.notBefore = new Date();
              cert.validity.notAfter = new Date();
              cert.validity.notAfter.setFullYear(
                  cert.validity.notBefore.getFullYear() + 1
              );
              
              const caAttrs = [
                  {name: "commonName", value: options?.commonName??"example-ca.org"},
                  {name: "countryName", value: options?.countryName??"GB"},
                  {name: "localityName", value: options?.localityName??"GB"},
                  {name: "organizationName", value: options?.organizationName??""},
                  {shortName: "OU", value: options?.OU??"test"}
              ];
              
              cert.setSubject(caAttrs);
              cert.setIssuer(caAttrs);
              cert.setExtensions([
                  { name: "basicConstraints", cA: true },
                  { name: "keyUsage",
                    keyCertSign: true,
                    digitalSignature: true,
                    keyEncipherment: true,
                    dataEncipherment: true },
                  { name: "extKeyUsage",
                    serverAuth: true,
                    clientAuth: true,
                    codeSigning: true,
                    emailProtection: true,
                    timeStamping: true },
                  { name: "nsCertType",
                    client: true,
                    server: true,
                    email: true,
                    objsign: true,
                    sslCA: true,
                    emailCA: true,
                    objCA: true },
                  { name: "subjectAltName",
                    altNames: [
                        { type: 6, value: options?.commonName
                          ? `http://www.${options?.commonName}`
                          : "http://www.example-ca.org" },
                        { type: 7, ip: "127.0.0.1" }
                    ]},
                  { name: "subjectKeyIdentifier" }
              ]);
              cert.sign(caPrivateKey);
              const store = pki.createCaStore([pki.certificateToPem(cert)]);
              return {
                  store,
                  certificate: cert,
                  privateKey: caPrivateKey,
                  publicKey: caPublicKey,
                  caAttrs
              };
          })();

    return {
        caCert,
        caPrivateKey,
        caPublicKey,
        getSerialNumber() {
            return serial;
        },
        issue(publicKeyInPem, csrInPem) {
            console.log("issue ca attrs:", caAttrs);
            const publicKey = pki.publicKeyFromPem(publicKeyInPem);
            const csrToSign = pki.certificationRequestFromPem(csrInPem);
            const cert = pki.createCertificate();
            cert.publicKey = publicKey;
            cert.serialNumber = serialNumber();
            console.log("fake ca issuing serial number", cert.serialNumber);
            cert.validity.notBefore = new Date();
            cert.validity.notAfter = new Date();
            cert.validity.notAfter.setFullYear(
                cert.validity.notBefore.getFullYear() + 1
            );
            cert.setSubject(csrToSign.subject.attributes);
            
            // To CA sign the cert the CA simply does this:
            console.log("about to set caAttrs:", caAttrs);
            cert.setIssuer(caAttrs);
            
            const extensions = csrToSign.getAttribute({name: "extensionRequest"}).extensions;
            extensions.push.apply(extensions, [
                { name: "basicConstraints", cA: false },
                { name: "keyUsage",
                  keyCertSign: true,
                  digitalSignature: true,
                  nonRepudiation: true,
                  keyEncipherment: true,
                  dataEncipherment: true }
            ]);
            
            cert.setExtensions(extensions);
            const hash = md.sha256.create();
            cert.sign(caPrivateKey, hash);

            const certInPem = pki.certificateToPem(cert);
            const certChain = pki.certificateToPem(caCert) + certInPem;

            return {
                cert: certInPem,
                ca: pki.certificateToPem(caCert),
                getPkcs12: function (privateKeyPem, pkcs12password="secret") {
                    const certChain = certInPem + pki.certificateToPem(caCert);

                    // Encode as PKCS12 with a password
                    const certAsPkcs12 = pkcs12.toPkcs12Asn1(
                        pki.privateKeyFromPem(privateKeyPem),
                        certChain,
                        pkcs12password,
                        {algorithm: '3des'}
                    );
                    
                    const certPkcs12Der = asn1.toDer(certAsPkcs12).getBytes();
                    const certPkcs12DerBase64 = util.encode64(certPkcs12Der);

                    return {
                        pkcs12: certPkcs12DerBase64,
                        pkcs12password
                    }
                }
            };
        }
    };
};


const csrDefaultOptions = {
    commonName: "localhost",
    countryName: "GB",
    localityName: "GB",
    organizationName: "Example",
    OU: "Example"
};

// For detecting if the altname is an IP address
const ipv4Regex = new RegExp("^([0-9]+\\.){3}[0-9]+");

// altNames should just be a list of names
const makeCsr = function (csrOptions = {}, altNames = []) {
    console.log("make csr altNames:", altNames);
    const csrOpts = Object.assign(csrDefaultOptions, csrOptions);
    const subjectDetails = Object.keys(csrOpts).map(key => {
        if (key == "OU") {
            return { shortName: key, value: csrOpts[key] };
        }
        return { name: key, value: csrOpts[key] };
    });

    const keys = pki.rsa.generateKeyPair(2048);
    const csr = pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;

    // console.log("csr subject details", subjectDetails);
    csr.setSubject(subjectDetails);

    const altNameList = altNames.concat([csrOpts.commonName]).map(name => {
        if (ipv4Regex.test(name)) {
            return [{
                type: 7, ip: name
            }];
        }
        return [{
            type: 6, value: name
        }];
    })[0];

    // DEBUG 
    // console.log("make csr altNameList:", altNameList);
    
    csr.setAttributes([
        { name: "unstructuredName", value: "My Example Cert" },
        { name: "extensionRequest",
          extensions: [{
              name: "subjectAltName",
              altNames: altNameList
          }]
        }
    ]);
    
    // We sign the certification request
    csr.sign(keys.privateKey);

    // We should verify it before sending
    const verifiedCSR = csr.verify();
    
    // Convert it to PEM to send to the CA
    const csrInPem = pki.certificationRequestToPem(csr);
    const pemPrivate = pki.privateKeyToPem(keys.privateKey);
    const pemPublic = pki.publicKeyToPem(keys.publicKey);
    return [pemPrivate, pemPublic, csrInPem];
};

exports.makeCa = makeCa;
exports.makeCsr = makeCsr;
exports.pki = pki;

// End

