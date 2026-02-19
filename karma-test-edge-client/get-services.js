
import {ZitiBrowzerCore} from "../dist/esm/index.js";

// var updbUser = window.__env__['ZITI_EDGE_CLIENT_TESTS_USER'];
// var updbPswd = window.__env__['ZITI_EDGE_CLIENT_TESTS_PSWD'];
var updbUser = 'curt';
var updbPswd = 'browzer!';


describe("get-services", function () {
  this.timeout(5000);

  beforeEach(async function () {
    this.ztBrowzerCore = new ZitiBrowzerCore();
    this.logger = this.ztBrowzerCore.createZitiLogger({
      logLevel: 'Trace',
      suffix: 'get-services'
    });

  });

  it("get Services", async function () {
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

    let token = await ztContext.getFreshAPISession();
    console.log('token is: ', token);
    expect(token).to.not.equal(undefined);

    await ztContext.fetchServices();
    let services = ztContext.services;
    // console.log('services is: ', services);
    expect(services).to.not.equal(undefined);

    let id = ztContext.getServiceIdByName('mattermost-blue');
    console.log('id is: ', id);
    expect(id).to.not.equal(undefined);

    let encryptionRequired = ztContext.getServiceEncryptionRequiredByName('mattermost-blue');
    console.log('encryptionRequired is: ', encryptionRequired);
    expect(encryptionRequired).to.not.equal(undefined);
    expect(encryptionRequired).to.equal(false);

    let networkSession = await ztContext.getNetworkSessionByServiceId(id);
    console.log('networkSession is: ', networkSession);
    expect(networkSession).to.not.equal(undefined);
  

  });

});

