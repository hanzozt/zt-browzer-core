
import {ZitiBrowzerCore} from "../dist/esm/index.js";

// var updbUser = window.__env__['ZITI_EDGE_CLIENT_TESTS_USER'];
// var updbPswd = window.__env__['ZITI_EDGE_CLIENT_TESTS_PSWD'];
var updbUser = 'curt';
var updbPswd = 'browzer!';


describe("ssl", function () {
  this.timeout(5000);

  beforeEach(async function () {
    this.ztBrowzerCore = new ZitiBrowzerCore();
    this.logger = this.ztBrowzerCore.createZitiLogger({
      logLevel: 'Trace',
      suffix: 'ssl'
    });

  });

  it("should make an SSL context", async function () {
    let ztContext = this.ztBrowzerCore.createZitiContext({
      logger: this.logger,
      controllerApi: 'https://zt-edge-controller:1280',
      updbUser: updbUser,
      updbPswd: updbPswd,
    });
    expect(ztContext).to.not.equal(undefined);

    await ztContext.initialize();

    let ztBrowzerEdgeClient = ztContext.createZitiBrowzerEdgeClient({
        domain: 'https://zt-edge-controller:1280',
        logger: this.logger
    });
    expect(ztBrowzerEdgeClient).to.not.equal(undefined);

    let res = await ztBrowzerEdgeClient.listVersion();
    let controllerVersion = res.data.version;
    console.log('controllerVersion is: ', controllerVersion);
    expect(controllerVersion).to.not.equal(undefined);

    await ztContext.enroll();
    let certPem = await ztContext.getCertPEM();
    console.log('certPem is: ', certPem);
    expect(certPem).to.not.equal(undefined);
  
    let sslCtx = ztContext.ssl_CTX_new();
    console.log(sslCtx);
    expect(sslCtx).to.not.equal(undefined);  

    let sbio = ztContext.bio_new_ssl_connect();
    console.log(sbio);
    expect(sbio).to.not.equal(undefined);  

  });

});

