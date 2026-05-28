const HotPocket = require("hotpocket-nodejs-contract");
const bson = require("bson");
const { Controller } = require("./controller");
const { DBInitializer } = require("./Data.Deploy/initDB");
const { SharedService } = require("./Services/Common.Services/SharedService");

const contract = async ctx => {
  console.log("healthcare-appointments contract is running.");

  SharedService.context = ctx;

  if (!ctx.readonly) {
    ctx.unl.onMessage((node, msg) => {
      try {
        const obj = JSON.parse(msg.toString());
        if (obj.type) SharedService.nplEventEmitter.emit(obj.type, node, msg);
      } catch (e) {
        // ignore
      }
    });
  }

  await DBInitializer.init();

  const controller = new Controller();

  for (const user of ctx.users.list()) {
    for (const input of user.inputs) {
      const buf = await ctx.users.read(input);

      let message;
      try {
        message = JSON.parse(buf);
      } catch (e) {
        message = bson.deserialize(buf);
      }

      if (message.Data && !message.data) message.data = message.Data;

      await controller.handleRequest(ctx, user, message, ctx.readonly);
    }
  }
};

const hpc = new HotPocket.Contract();
hpc.init(contract, HotPocket.clientProtocols.JSON, true);
