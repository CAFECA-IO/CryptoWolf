# CryptoWolf
Trade Strategy and Execution with Artificial Intelligence

### edit config
```shell
cp /path/to/your/new/project/default.config.toml /path/to/your/new/project/private/config.toml
vi /path/to/your/new/project/private/config.toml
```
```toml

[api]
pathname = [
  "get | /,/version | Static.Utils.readPackageInfo"
]

# [method] | [path] | [execute function]
```

## Run Project
```
cd /path/to/your/new/project/
npm install
npm start
```

## Update Project with new version of MerMer-framework and Run
```
mermer update /path/to/your/new/project/
cd /path/to/your/new/project/
npm rebuild
npm start
```