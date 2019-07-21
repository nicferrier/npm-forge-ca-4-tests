const pki = require("node-forge").pki;

const makeCa = function () {
    const serialNumber = (function () {
        let serial = 1;
        return function() {
            serial = serial + 1;
            const serialString = "" + serial;
            return serialString.padStart(5, ""); // Not fantastic but enough for in memory ca
        }
    })();

    const caKeyPair = pki.rsa.generateKeyPair(2048);
    const caCert = pki.createCertificate();
    caCert.publicKey = caKeyPair.publicKey;
    caCert.serialNumber = serialNumber();
    caCert.validity.notBefore = new Date();
    caCert.validity.notAfter = new Date();
    caCert.validity.notAfter.setFullYear(
        caCert.validity.notBefore.getFullYear() + 1
    );

    const caAttrs = [
        {name: "commonName", value: "example-ca.org"},
        {name: "countryName", value: "GB"},
        {name: "localityName", value: "GB"},
        {name: "organizationName", value: "Example CA"},
        {shortName: "OU", value: "test"}
    ];

    caCert.setSubject(caAttrs);
    caCert.setIssuer(caAttrs);
    caCert.setExtensions([
        { name: "basicConstraints", cA: true },
        { name: "keyUsage",
          keyCertSign: true,
          digitalSignature: true,
          keyEncipherment: true,
          dataEncipherment: true },
        { name: "extKeyUsage",
          serverAuth: true, clientAuth: true,
          codeSigning: true, emailProtection: true,
          timeStamping: true },
        { name: "nsCertType",
          client: true, server: true, email: true, objsign: true,
          sslCA: true, emailCA: true, objCA: true },
        { name: "subjectAltName",
          altNames: [
              { type: 6, value: "http://www.example-ca.org" },
              { type: 7, ip: "127.0.0.1" }
          ]},
        { name: "subjectKeyIdentifier" }
    ]);

    caCert.sign(caKeyPair.privateKey);
    const caStore = pki.createCaStore([pki.certificateToPem(caCert)]);

    return {
        issue: function (publicKeyInPem, csrInPem) {
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
            cert.setIssuer(caAttrs);
            
            const extensions = csrToSign.getAttribute({name: "extensionRequest"}).extensions;
            extensions.push.apply(extensions, [
                { name: "basicConstraints", cA: true },
                { name: "keyUsage",
                  keyCertSign: true,
                  digitalSignature: true,
                  nonRepudiation: true,
                  keyEncipherment: true,
                  dataEncipherment: true }
            ]);
            
            cert.setExtensions(extensions);
            cert.sign(caKeyPair.privateKey);
            return {
                cert: pki.certificateToPem(cert),
                ca: pki.certificateToPem(caCert)
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
// altNames should just be a list of names
const makeCsr = function (csrOptions = {}, altNames = []) {
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

    const altNameList = altNames.concat([csrOpts.commonName]).map(name => [{
        type: 2, value: name
    }][0]);
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

