'use strict';

const Controller = require('egg').Controller;

class HomeController extends Controller {
  async index() {
    const { ctx } = this;
    ctx.body = 'hi, egg, 我是hidesign的后台';
  }
}

module.exports = HomeController;
