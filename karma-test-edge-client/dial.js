
import {ZitiBrowzerCore} from "../dist/esm/index.js";

// var updbUser = window.__env__['ZITI_EDGE_CLIENT_TESTS_USER'];
// var updbPswd = window.__env__['ZITI_EDGE_CLIENT_TESTS_PSWD'];
var updbUser = 'curt';
var updbPswd = 'browzer!';


describe("dial", function () {
  this.timeout(5000);

  beforeEach(async function () {
    this.ztBrowzerCore = new ZitiBrowzerCore();
    this.logger = this.ztBrowzerCore.createZitiLogger({
      logLevel: 'Trace',
      suffix: 'dial'
    });

  });

  it("Dial Services", async function () {
    console.log('window.__env__ is: ', window.__env__);

    let ztContext = this.ztBrowzerCore.createZitiContext({
      logger: this.logger,
      controllerApi: 'https://zt-edge-controller:1280',
      updbUser: updbUser,
      updbPswd: updbPswd,
    });
    expect(ztContext).to.not.equal(undefined);

    await ztContext.initialize();

    let conn = ztContext.newConnection();
    expect(conn).to.not.equal(undefined);
    expect(conn.ztContext).to.equal(ztContext);

    await ztContext.dial(conn, 'mattermost-blue');

    let expiryTime = await ztContext.getCertPEMExpiryTime();
    expect(expiryTime).to.not.equal(undefined);

  });

});

