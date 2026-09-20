'use strict';

module.exports = {
  himind: {
    baseUrl: 'http://himind.hikvision.com',
    ssoSecret: '20ee4e0d35e3567390cc92c7089b4c9f5c9a88e2544819eec6aae19f0a8b28ea',
    ssoIssuer: 'hidesign-web',
    ssoAudience: 'himind',
    ticketTtlSeconds: 60,
  },
  aiResearch: {
    baseUrl: 'http://drw.hikvision.com/',
    ssoSecret: '7f5b0b5d662a3a422285654d0aba79f2eafb2b6932c3c3e564e3fac30cb9159e',
    ssoIssuer: 'hidesign-web',
    ssoAudience: 'design-research-workbench',
    ticketTtlSeconds: 60,
  },
};
