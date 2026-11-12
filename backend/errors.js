const codes=new Set(['unauthenticated','permission-denied','invalid-argument','failed-precondition','aborted','resource-exhausted','unavailable','internal','deadline-exceeded','cancelled']);
const grpc={1:'cancelled',3:'invalid-argument',4:'deadline-exceeded',7:'permission-denied',8:'resource-exhausted',9:'failed-precondition',10:'aborted',13:'internal',14:'unavailable',16:'unauthenticated'};
// Infrastructure failures may occur after a transaction committed. Never label
// them as bad user input: clients must retain and retry the same operation ID.
export function serviceError(error){
 if(codes.has(error?.code))return {code:error.code,message:error.message||'操作未完成。',details:error.details||{}};
 const code=grpc[error?.code]||'internal';
 return {code,message:['unavailable','internal','deadline-exceeded','cancelled'].includes(code)?'儲存結果尚未確認，請保留操作並稍後重試。':'請求無法完成，請重新確認。',details:{}};
}
