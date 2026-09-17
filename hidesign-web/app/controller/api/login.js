'use strict';
const crypto = require('crypto');

const Controller = require('egg').Controller;

class LoginController extends Controller {
    async login() {
        const { ctx, app } = this;
        let userid = ctx.request.body.userid;
        let username = ctx.request.body.username;
        if (userid && username) {
            // ctx.rotateCsrfSecret();
            let userInfo = {
                userid,
                username
            }
            let md5Str = crypto.createHash('md5')
                .update(`username=${userInfo.username};secret=${app.config.jwt.secret}`)
                .digest('hex').toUpperCase();
            // console.log('我的MD5', md5Str)
            let isManager = app.config.jwt.managerKeys?.includes(md5Str);
            let isAdmin = app.config.jwt.adminKeys?.includes(md5Str);
            const token = app.jwt.sign(userInfo, app.config.jwt.secret);

            ctx.body = {
                code: 0,
                msg: '登录成功',
                data: {
                    token,
                    isAdmin,
                    isManager: isAdmin || isManager
                }
            };
        }else {
            ctx.body = {
                code: -1,
                msg: '登录失败'
            };
        }
    }
}

module.exports = LoginController;
