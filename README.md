## Repository containing cdk code that is reused by microservices in PDE's new architecture.

> [!CAUTION]
> Please check with SRE team before making any changes

![This is fine](https://miro.medium.com/v2/format:webp/0*ZjYSm_q36J4KChdn)

> [!WARNING]  
> Before building the package, make sure you increase the version in the package.json
> Otherwise your content will not be published to the registry.

Use VWS2 to login in AWS and configure NPM:
```
vws2
vws2-artifacts
```

To build the package, run the following NPM command:
```
npm run pack
```
This will clear any local packs and dists, alongside node modules, and build the package.

To publish the package, make sure you login using the command bellow (your password is your git token):
```
npm login --registry=https://npm.pkg.github.com
```

After loging in, publish the package to NPM registry on GitHub:
```
npm publish
```


### Using the package in a different repository

When using a package in a project, you must make sure that you have the correct dependency and version in your package.json:

`"@pre-delivery-enrolment/cdk-commons": "0.1.0"`


Additionally, you need to add the line bellow to your .npmrc file

`@pre-delivery-enrolment:registry=https://npm.pkg.github.com/pre-delivery-enrolment`
