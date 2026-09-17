'use strict';

const Controller = require('egg').Controller;

class TestController extends Controller {
  async index() {
    const { ctx } = this;
    ctx.body = {
      code: 0,
      msg: 'SUCCESS',
      data: {
        message: 'hdw test route ok',
        time: new Date().toISOString(),
      },
    };
  }
}

module.exports = TestController;
