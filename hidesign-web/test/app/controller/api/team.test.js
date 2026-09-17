'use strict';

const assert = require('assert');
const TeamController = require('../../../../app/controller/api/team');

describe('test/app/controller/api/team.test.js', () => {
  it('only lets owner and admin reach the invite mutation', async () => {
    const controller = Object.create(TeamController.prototype);
    controller.ctx = {
      request: {
        body: {
          workspace_id: 'workspace-1',
          operator_member_id: 'member-1',
          members: [{ username: 'invitee' }],
        },
      },
    };
    controller.getKnex = () => ({});

    let allowedRoles;
    controller._checkOperator = async (_memberId, _workspaceId, roles) => {
      allowedRoles = roles;
      return { error: 'stop after authorization check' };
    };

    await controller.invite();

    assert.deepStrictEqual(allowedRoles, ['owner', 'admin']);
    assert.strictEqual(controller.ctx.body.error, 'stop after authorization check');
  });
});
