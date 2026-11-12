// Disposable demo identities only. Check the actual callable and Rules before
// spending time compiling/booting iOS; do not mistake open ports for readiness.
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,GoogleAuthProvider,signInWithCredential,signOut} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDoc,terminate} from 'firebase/firestore';
import {getFunctions,connectFunctionsEmulator,httpsCallable} from 'firebase/functions';
const projectId='demo-weekly-meal-public',started=Date.now();
const timeout=setTimeout(()=>{console.error('Native backend readiness exceeded90seconds.');process.exit(1);},90000);
const app=initializeApp({projectId,apiKey:'demo-key'},'native-readiness');
const auth=getAuth(app),db=getFirestore(app),functions=getFunctions(app,'us-central1');
connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
connectFirestoreEmulator(db,'127.0.0.1',8080);connectFunctionsEmulator(functions,'127.0.0.1',5001);
try{
 const sub='native-readiness-'+Date.now();
 await signInWithCredential(auth,GoogleAuthProvider.credential(JSON.stringify({sub,email:sub+'@example.com',email_verified:true})));
 console.log('Native backend readiness: Auth confirmed after '+(Date.now()-started)+'ms');
 const value=(await httpsCallable(functions,'mealAccount',{timeout:60000})({action:'bootstrap',payload:{}})).data;
 console.log('Native backend readiness: callable confirmed after '+(Date.now()-started)+'ms');
 const confirmed=await getDoc(doc(db,value.dataPath));
 if(!confirmed.exists()||confirmed.metadata.fromCache||confirmed.data().revision!==value.revision)throw new Error('Canonical Firestore state not confirmed.');
 if(!value.snapshot.state.plan.startDate||!value.snapshot.state.plan.nextWeek.plan.startDate)throw new Error('Two-week account contract missing.');
 console.log('Native backend readiness: Rules and server data confirmed after '+(Date.now()-started)+'ms');
 const deleted=(await httpsCallable(functions,'mealAccount',{timeout:60000})({action:'deleteAccount',payload:{confirmation:'DELETE_MY_ACCOUNT'}})).data;
 if(deleted.status!=='completed')throw new Error('Disposable account deletion did not complete.');
 console.log('Native backend readiness: disposable account deletion confirmed after '+(Date.now()-started)+'ms');
}catch(error){console.error('Native backend readiness failed:',error.code||'unknown',error.message);process.exitCode=1;}
finally{await signOut(auth);await terminate(db);await deleteApp(app);clearTimeout(timeout);}
