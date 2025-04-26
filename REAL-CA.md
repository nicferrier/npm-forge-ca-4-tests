# A Real CA with forge-ca-4-tests

A _real_ CA server is a server that will make a CA and persist state
and continuously hand out certs, so now this package includes one of
those as well as the completely unit test driven tool.

The server can be stopped and restarted and it will just continue
where it left off.

So it's very like a CA server implementation might look but it's a lot
simpler.

You can initialze the server like this:

```
$ nicferrier-real-ca init-ca
```

This will make a `realca` directory in the current directory. That
directory will contain the state of the CA.

You can then start the server like this:

```
$ nicferrier-real-ca start-ca
```

That will fail if it can't find the `realca` directory in the current
directory.

The server starts an HTTP server on port `10080` which can be used to
fetch the root certificate.

It also starts an HTTPS server on port `10443` which is identified by
a cert from the same root certificate chain. This server has an
endpoint that can create another certificate and so can be used by
application code.

So you can then fetch a CA with this code:

```javascript
import fetch from "node-fetch";
import url from "node:url";

// The URL we want a certificate for
const hostingUrl = new url.URL("https://localhost:8000");
// Let's try and get the cert from remote cert server
const caUrl = "http://localhost:10080";
console.log(`fetching certificate from ${caUrl}...`);
const [caCertFetchErr, caCertFetchRes] = await fetch(caUrl).then(r=>[,r]).catch(e=>[e]);
if (caCertFetchErr || caCertFetchRes.status !== 200) {
    console.log("Aborting because cannot fetch the CA cert:",
                caCertFetchErr??`http: ${caCertFetchRes.status}`);
    process.exit(1);  // we could c(error) instead
}

const caCertPemData = await caCertFetchRes.text();
const tlsEndpointLocation = caCertFetchRes.headers.get("location");
console.log("tls cert fetch endpoint location:", tlsEndpointLocation);

const agent = new https.Agent({ca: caCertPemData });

// Now get the actual cert we'll start this webserver with
const [certFetchErr, certFetchRes] = await fetch(tlsEndpointLocation, {
    method: "POST",
    agent
}).then(r=>[,r]).catch(e=>[e]);
if (certFetchErr || certFetchRes.status !== 201) {
    console.log("Aborting because can't make certificate:",
                certFetchErr??`http: ${certFetchRes.status}`);
    process.exit(1);  // we could c(error) instead
}
const certJson = await certFetchRes.json();
const {privateKeyInPem, cert} = certJson;

console.log("received certificate");

// Start my app server with the certificate
const tlsOpts = {
    key: privateKeyInPem,
    cert
};

const myAppServerListener = new Promise((t,c) => {
    const listener = https.createServer(tlsOpts, (request, response) => {
        res.writeHead(200);                            
        res.end('hello world\n');
    }).listen(hostingUrl.port, _ => t(listener));
});
```


## Making a cert from the command line with the real-ca

You can also use a pre-canned cert acquirer from the command-line.

First, start the ca, perhaps on a different port than the default:

```
nicferrier-real-ca start-ca 10081 10444 &
```

This will write the current port numbers into the `realca` directory.

Then you can call the `make-cert` command:

```
nicferrier-real-ca make-cert
```

this will talk to the server and grab a cert and output it to the
console.

If you want the cert saved into files you can do that by specifying a
prefix for the filenames:

```
nicferrier-real-ca make-cert mysite
```

will save `mysite-privatekey.pem` and `mysite-cert.pem`.

Additionally, `make-cert` needs to know where the `realca` directory
is. By default it's `./realca` but it can also be specified by using
the environment variable `REALCADIR`.

For example, consider this initialization of a real CA all the way to
getting a certificate to be store in the directory of an app:

```
cd ~/projects
mkdir realca
nicferrier-real-ca init-ca mysite.com
nicferrier-real-ca start-ca 10081 10444 &
cd ../myapp
REALCADIR=~/projects/realca nicferrier-real-ca make-cert myapp-dev
```

this will result in a `myapp-dev-cert.pem` and a
`myapp-dev-privatekey.pem` file in the `myapp` directory.


## I need an ALT name in my _real_ cert!

Sure, you can do that too, when you request the actual certificate:

```javascript
const [certFetchErr, certFetchRes] = await fetch(tlsEndpointLocation, {
    method: "POST",
    body: new url.URLSearchParams("altName=my-real-server.example.com")
    agent
}).then(r=>[,r]).catch(e=>[e]);
```

In addition, you can specify an IP address and it will be
auto-detected as an IP:

```javascript
const [certFetchErr, certFetchRes] = await fetch(tlsEndpointLocation, {
    method: "POST",
    body: new url.URLSearchParams("altName=127.0.0.1")
    agent
}).then(r=>[,r]).catch(e=>[e]);
```

These are set appropriately as a type 6 alt-name for a non-ip address
and a type 7 for an ip-address.

_fin_
