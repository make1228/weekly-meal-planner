"""Deterministic Xcode project, with explicit source/resource and SPM dependencies."""
from pathlib import Path
import json, hashlib, plistlib
root=Path(__file__).resolve().parents[1]/'ios'
objects={}
def ident(label):return hashlib.sha256(label.encode()).hexdigest()[:24].upper()
def add(label,isa,**fields):
 key=ident(label);objects[key]={'isa':isa,**fields};return key
def ref(label):return ident(label)
def dump(value):
 if isinstance(value,dict):return '{ '+ ' '.join(str(k)+' = '+dump(v)+';' for k,v in value.items())+' }'
 if isinstance(value,list):return '('+', '.join(dump(v) for v in value)+',)' if value else '()'
 if isinstance(value,int):return str(value)
 return json.dumps(str(value),ensure_ascii=False)
sources=sorted((root/'WeeklyMealPlanner').glob('*.swift'))
resources=[root/'WeeklyMealPlanner/catalog.v2.json',root/'WeeklyMealPlanner/Assets.xcassets',root/'WeeklyMealPlanner/PrivacyInfo.xcprivacy']
tests=sorted((root/'WeeklyMealPlannerTests').glob('*.swift'))
if (root/'WeeklyMealPlanner/GoogleService-Info.plist').exists():resources.append(root/'WeeklyMealPlanner/GoogleService-Info.plist')
testResources=[root/'WeeklyMealPlannerTests/portion-vectors.json',root/'WeeklyMealPlanner/catalog.v2.json']
children=[]
def file(p):
 rel=p.relative_to(root).as_posix();key=ident('file:'+rel)
 if key not in objects:
  types={'.swift':'sourcecode.swift','.json':'text.json','.xcassets':'folder.assetcatalog','.xcprivacy':'text.xml','.plist':'text.plist.xml','.xcconfig':'text.xcconfig'}
  add('file:'+rel,'PBXFileReference',lastKnownFileType=types.get(p.suffix,'text'),path=rel,sourceTree='<group>');children.append(key)
 return key
def phase(label,kind,files):
 entries=[]
 for p in files:
  entries.append(add('build:'+label+':'+p.as_posix(),'PBXBuildFile',fileRef=file(p)))
 return add(label,kind,buildActionMask=2147483647,files=entries,runOnlyForDeploymentPostprocessing=0)
appSources=phase('app-sources','PBXSourcesBuildPhase',sources)
appResources=phase('app-resources','PBXResourcesBuildPhase',resources)
testSources=phase('test-sources','PBXSourcesBuildPhase',tests)
testResourcesPhase=phase('test-resources','PBXResourcesBuildPhase',testResources)
packages=[
 add('firebase-package','XCRemoteSwiftPackageReference',repositoryURL='https://github.com/firebase/firebase-ios-sdk.git',requirement={'kind':'exactVersion','version':'13.1.1'}),
 add('google-package','XCRemoteSwiftPackageReference',repositoryURL='https://github.com/google/GoogleSignIn-iOS.git',requirement={'kind':'exactVersion','version':'10.1.0'})
]
products=[];frameworkFiles=[]
for name in ['FirebaseCore','FirebaseAuth','FirebaseFirestore','FirebaseFunctions','FirebaseAppCheck','GoogleSignIn']:
 product=add('product:'+name,'XCSwiftPackageProductDependency',package=packages[1 if name=='GoogleSignIn' else 0],productName=name)
 products.append(product);frameworkFiles.append(add('framework-build:'+name,'PBXBuildFile',productRef=product))
frameworks=add('frameworks','PBXFrameworksBuildPhase',buildActionMask=2147483647,files=frameworkFiles,runOnlyForDeploymentPostprocessing=0)
testFrameworks=add('test-frameworks','PBXFrameworksBuildPhase',buildActionMask=2147483647,files=[],runOnlyForDeploymentPostprocessing=0)
appProduct=add('app-product','PBXFileReference',explicitFileType='wrapper.application',includeInIndex=0,path='WeeklyMealPlanner.app',sourceTree='BUILT_PRODUCTS_DIR')
testProduct=add('test-product','PBXFileReference',explicitFileType='wrapper.cfbundle',includeInIndex=0,path='WeeklyMealPlannerTests.xctest',sourceTree='BUILT_PRODUCTS_DIR')
productsGroup=add('products','PBXGroup',children=[appProduct,testProduct],name='Products',sourceTree='<group>')
for p in [root/'WeeklyMealPlanner/Info.plist',root/'WeeklyMealPlanner/WeeklyMealPlanner.entitlements',root/'Local.example.xcconfig',root/'App.xcconfig']:file(p)
configs={}
baseProject={'CLANG_ENABLE_MODULES':'YES','IPHONEOS_DEPLOYMENT_TARGET':'17.0','SWIFT_VERSION':'5.0','SDKROOT':'iphoneos','ENABLE_USER_SCRIPT_SANDBOXING':'YES'}
for target in ['project','app','test']:
 ids=[]
 for mode in ['Debug','Release']:
  settings=dict(baseProject)
  settings.update({'SWIFT_OPTIMIZATION_LEVEL':'-Onone' if mode=='Debug' else '-O','DEBUG_INFORMATION_FORMAT':'dwarf' if mode=='Debug' else 'dwarf-with-dsym','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG' if mode=='Debug' else ''})
  if target=='app':settings.update({'PRODUCT_NAME':'WeeklyMealPlanner','INFOPLIST_FILE':'WeeklyMealPlanner/Info.plist','CODE_SIGN_ENTITLEMENTS':'WeeklyMealPlanner/WeeklyMealPlanner.entitlements','CODE_SIGN_STYLE':'Automatic','TARGETED_DEVICE_FAMILY':'1,2','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','GENERATE_INFOPLIST_FILE':'NO','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks']})
  if target=='test':settings.update({'PRODUCT_NAME':'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER':'com.example.weeklymealplanner.tests','GENERATE_INFOPLIST_FILE':'YES','TEST_HOST':'$(BUILT_PRODUCTS_DIR)/WeeklyMealPlanner.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/WeeklyMealPlanner','BUNDLE_LOADER':'$(TEST_HOST)','CODE_SIGN_STYLE':'Automatic','TARGETED_DEVICE_FAMILY':'1,2'})
  if target=='test':settings['TEST_HOST']='$(BUILT_PRODUCTS_DIR)/WeeklyMealPlanner.app/WeeklyMealPlanner'
  ids.append(add('config:'+target+mode,'XCBuildConfiguration',buildSettings=settings,name=mode,**({'baseConfigurationReference':file(root/'App.xcconfig')} if target=='app' else {})))
 configs[target]=add('configlist:'+target,'XCConfigurationList',buildConfigurations=ids,defaultConfigurationIsVisible=0,defaultConfigurationName='Release')
proxy=add('test-proxy','PBXContainerItemProxy',containerPortal=ref('project'),proxyType=1,remoteGlobalIDString=ref('app-target'),remoteInfo='WeeklyMealPlanner')
dependency=add('test-dependency','PBXTargetDependency',target=ref('app-target'),targetProxy=proxy)
add('app-target','PBXNativeTarget',buildConfigurationList=configs['app'],buildPhases=[appSources,frameworks,appResources],buildRules=[],dependencies=[],name='WeeklyMealPlanner',packageProductDependencies=products,productName='WeeklyMealPlanner',productReference=appProduct,productType='com.apple.product-type.application')
add('test-target','PBXNativeTarget',buildConfigurationList=configs['test'],buildPhases=[testSources,testFrameworks,testResourcesPhase],buildRules=[],dependencies=[dependency],name='WeeklyMealPlannerTests',productName='WeeklyMealPlannerTests',productReference=testProduct,productType='com.apple.product-type.bundle.unit-test')
group=add('main-group','PBXGroup',children=children+[productsGroup],sourceTree='<group>')
add('project','PBXProject',attributes={'BuildIndependentTargetsInParallel':'YES','LastSwiftUpdateCheck':'2600','LastUpgradeCheck':'2600','TargetAttributes':{ref('app-target'):{'CreatedOnToolsVersion':'26.0'},ref('test-target'):{'CreatedOnToolsVersion':'26.0','TestTargetID':ref('app-target')}}},buildConfigurationList=configs['project'],compatibilityVersion='Xcode 15.0',developmentRegion='zh-Hant',hasScannedForEncodings=0,knownRegions=['zh-Hant','en','Base'],mainGroup=group,packageReferences=packages,productRefGroup=productsGroup,projectDirPath='',projectRoot='',targets=[ref('app-target'),ref('test-target')])
project={'archiveVersion':1,'classes':{},'objectVersion':60,'objects':objects,'rootObject':ref('project')}
(root/'WeeklyMealPlanner.xcodeproj/project.pbxproj').write_text('// !$*UTF8*$!\n'+dump(project)+'\n')
scheme='''<?xml version="1.0" encoding="UTF-8"?><Scheme LastUpgradeVersion="2600" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="APPID" BuildableName="WeeklyMealPlanner.app" BlueprintName="WeeklyMealPlanner" ReferencedContainer="container:WeeklyMealPlanner.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB"><Testables><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="TESTID" BuildableName="WeeklyMealPlannerTests.xctest" BlueprintName="WeeklyMealPlannerTests" ReferencedContainer="container:WeeklyMealPlanner.xcodeproj"/></TestableReference></Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="APPID" BuildableName="WeeklyMealPlanner.app" BlueprintName="WeeklyMealPlanner" ReferencedContainer="container:WeeklyMealPlanner.xcodeproj"/></BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>'''
(root/'WeeklyMealPlanner.xcodeproj/xcshareddata/xcschemes/WeeklyMealPlanner.xcscheme').write_text(scheme.replace('APPID',ref('app-target')).replace('TESTID',ref('test-target')))
print('Generated Xcode project with',len(sources),'app Swift sources and',len(tests),'test sources.')
