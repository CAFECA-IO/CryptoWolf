# CryptoWolf
Trade Strategy and Execution with Artificial Intelligence

### edit config
```shell
cp /path/to/your/new/project/default.config.toml /path/to/your/new/project/private/config.toml
vi /path/to/your/new/project/private/config.toml
```
```toml
[blockchain]
type = "ethereum"
blockchainId = 'F000003C'                 # according tidewallet backend
factoryContractAddress = ''               # factory address in router
routerContractAddress = '0xabcd123456...' # router address
token0Address = ''                        # pair token 0 address in pair contract
token1Address = ''                        # pair token 1 address in pair contract

[database]
apiKey = ''                               # your own apiKey
apiSecret = ''                            # your own apiSecret
thirdPartyId = 'myAppleID'                # your own appleID for tidebitwallet
installId = 'myInstallID'                 # your own installID for tidebitwallet
```

## Run Project
```
cd /path/to/your/new/project/
npm install
npm start
```