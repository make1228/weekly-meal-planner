// Main stays on the existing service until an explicit, verified production cutover.
// The staging build replaces this module; no runtime URL parameter can switch tenants.
export const accountConfig=Object.freeze({mode:'legacy',environment:'production'});
