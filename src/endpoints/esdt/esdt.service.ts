import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { CacheInfo } from "src/utils/cache.info";
import { TokenProperties } from "src/endpoints/tokens/entities/token.properties";
import { VmQueryService } from "src/endpoints/vm.query/vm.query.service";
import { TokenHelpers } from "src/utils/token.helpers";
import { ApiConfigService } from "../../common/api-config/api.config.service";
import { GatewayService } from "../../common/gateway/gateway.service";
import { TokenRoles } from "../tokens/entities/token.roles";
import { AssetsService } from "../../common/assets/assets.service";
import { EsdtLockedAccount } from "./entities/esdt.locked.account";
import { EsdtSupply } from "./entities/esdt.supply";
import { BinaryUtils, Constants, CachingService, AddressUtils, OriginLogger, BatchUtils } from "@multiversx/sdk-nestjs";
import { IndexerService } from "src/common/indexer/indexer.service";
import { EsdtType } from "./entities/esdt.type";
import { ElasticIndexerService } from "src/common/indexer/elastic/elastic.indexer.service";
import { randomUUID } from "crypto";

@Injectable()
export class EsdtService {
  private readonly logger = new OriginLogger(EsdtService.name);

  constructor(
    private readonly gatewayService: GatewayService,
    private readonly apiConfigService: ApiConfigService,
    private readonly cachingService: CachingService,
    private readonly vmQueryService: VmQueryService,
    private readonly indexerService: IndexerService,
    @Inject(forwardRef(() => AssetsService))
    private readonly assetsService: AssetsService,
    private readonly elasticIndexerService: ElasticIndexerService
  ) { }

  async getEsdtTokenProperties(identifier: string): Promise<TokenProperties | undefined> {
    const properties = await this.cachingService.getOrSetCache(
      CacheInfo.EsdtProperties(identifier).key,
      async () => await this.getEsdtTokenPropertiesRaw(identifier),
      Constants.oneWeek(),
      CacheInfo.EsdtProperties(identifier).ttl
    );

    if (!properties) {
      return undefined;
    }

    return properties;
  }

  async getEsdtAddressesRoles(identifier: string): Promise<TokenRoles[] | undefined> {
    const addressesRoles = await this.cachingService.getOrSetCache(
      CacheInfo.EsdtAddressesRoles(identifier).key,
      async () => await this.getEsdtAddressesRolesRaw(identifier),
      Constants.oneWeek(),
      CacheInfo.EsdtAddressesRoles(identifier).ttl
    );

    if (!addressesRoles) {
      return undefined;
    }

    return addressesRoles;
  }

  async getEsdtTokenPropertiesRaw(identifier: string): Promise<TokenProperties | null> {
    const isIndexerV5Active = await this.elasticIndexerService.isIndexerV5Active();
    if (isIndexerV5Active) {
      return await this.getEsdtTokenPropertiesRawFromElastic(identifier);
    } else {
      return await this.getEsdtTokenPropertiesRawFromGateway(identifier);
    }
  }

  async getEsdtTokenPropertiesRawFromElastic(identifier: string): Promise<TokenProperties | null> {
    const elasticProperties = await this.elasticIndexerService.getEsdtProperties(identifier);
    return this.mapEsdtTokenPropertiesFromElastic(elasticProperties);
  }

  async getEsdtTokenPropertiesRawFromGateway(identifier: string): Promise<TokenProperties | null> {
    const arg = Buffer.from(identifier, 'utf8').toString('hex');

    const tokenPropertiesEncoded = await this.vmQueryService.vmQuery(
      this.apiConfigService.getEsdtContractAddress(),
      'getTokenProperties',
      undefined,
      [arg],
      undefined,
      true
    );

    if (!tokenPropertiesEncoded) {
      // this.logger.error(`Could not fetch token properties for token with identifier '${identifier}'`);
      return null;
    }

    const tokenProperties = tokenPropertiesEncoded.map((encoded, index) =>
      Buffer.from(encoded, 'base64').toString(index === 2 ? 'hex' : undefined)
    );

    const [
      name,
      type,
      owner,
      _,
      __,
      decimals,
      isPaused,
      canUpgrade,
      canMint,
      canBurn,
      canChangeOwner,
      canPause,
      canFreeze,
      canWipe,
      canAddSpecialRoles,
      canTransferNFTCreateRole,
      NFTCreateStopped,
      wiped,
    ] = tokenProperties;

    const tokenProps: TokenProperties = {
      identifier,
      name,
      // @ts-ignore
      type,
      owner: AddressUtils.bech32Encode(owner),
      decimals: parseInt(decimals.split('-').pop() ?? '0'),
      isPaused: TokenHelpers.canBool(isPaused),
      canUpgrade: TokenHelpers.canBool(canUpgrade),
      canMint: TokenHelpers.canBool(canMint),
      canBurn: TokenHelpers.canBool(canBurn),
      canChangeOwner: TokenHelpers.canBool(canChangeOwner),
      canPause: TokenHelpers.canBool(canPause),
      canFreeze: TokenHelpers.canBool(canFreeze),
      canWipe: TokenHelpers.canBool(canWipe),
      canAddSpecialRoles: TokenHelpers.canBool(canAddSpecialRoles),
      canTransferNFTCreateRole: TokenHelpers.canBool(canTransferNFTCreateRole),
      NFTCreateStopped: TokenHelpers.canBool(NFTCreateStopped),
      wiped: wiped.split('-').pop() ?? '',
    };

    if (type === 'FungibleESDT') {
      // @ts-ignore
      delete tokenProps.canTransferNFTCreateRole;
      // @ts-ignore
      delete tokenProps.NFTCreateStopped;
      // @ts-ignore
      delete tokenProps.wiped;
    }

    return tokenProps;
  }

  async getAllFungibleTokenProperties(): Promise<TokenProperties[]> {
    const isIndexerV5Active = await this.elasticIndexerService.isIndexerV5Active();
    if (isIndexerV5Active) {
      return await this.getAllFungibleTokenPropertiesFromElastic();
    } else {
      return await this.getAllFungibleTokenPropertiesFromGateway();
    }
  }

  async getAllFungibleTokenPropertiesFromElastic(): Promise<TokenProperties[]> {
    const elasticProperties = await this.elasticIndexerService.getAllFungibleTokens();
    return elasticProperties.map(property => this.mapEsdtTokenPropertiesFromElastic(property));
  }

  async getAllFungibleTokenPropertiesFromGateway(): Promise<TokenProperties[]> {
    let tokensIdentifiers: string[];
    try {
      tokensIdentifiers = await this.gatewayService.getEsdtFungibleTokens();
    } catch (error) {
      this.logger.error('Error when getting fungible tokens from gateway');
      this.logger.error(error);
      return [];
    }

    const tokensProperties = await this.cachingService.batchProcess(
      tokensIdentifiers,
      token => CacheInfo.EsdtProperties(token).key,
      async (identifier: string) => await this.getEsdtTokenPropertiesRawFromGateway(identifier),
      Constants.oneDay(),
      true
    );

    return tokensProperties.filter(x => x !== null) as TokenProperties[];
  }

  private mapEsdtTokenPropertiesFromElastic(elasticProperties: any): TokenProperties {
    const tokenProps = new TokenProperties({
      identifier: elasticProperties.identifier,
      name: elasticProperties.name,
      type: elasticProperties.type as EsdtType,
      owner: elasticProperties.currentOwner,
      decimals: elasticProperties.numDecimals,
      canUpgrade: elasticProperties.properties.canUpgrade,
      canMint: elasticProperties.properties.canMint,
      canBurn: elasticProperties.properties.canBurn,
      canChangeOwner: elasticProperties.properties.canChangeOwner,
      canPause: elasticProperties.properties.canPause,
      canFreeze: elasticProperties.properties.canFreeze,
      canWipe: elasticProperties.properties.canWipe,
      canAddSpecialRoles: elasticProperties.properties.canAddSpecialRoles,
      canTransferNFTCreateRole: elasticProperties.properties.canTransferNFTCreateRole,
      NFTCreateStopped: elasticProperties.properties.NFTCreateStopped,
      isPaused: elasticProperties.properties.isPaused ?? false,
    });

    if (elasticProperties.type === 'FungibleESDT') {
      // @ts-ignore
      delete tokenProps.canTransferNFTCreateRole;
      // @ts-ignore
      delete tokenProps.NFTCreateStopped;
    }

    return tokenProps;
  }

  async getEsdtAddressesRolesRaw(identifier: string): Promise<TokenRoles[] | null> {
    const arg = BinaryUtils.stringToHex(identifier);

    const tokenAddressesAndRolesEncoded = await this.vmQueryService.vmQuery(
      this.apiConfigService.getEsdtContractAddress(),
      'getAllAddressesAndRoles',
      undefined,
      [arg],
      undefined,
      true
    );

    if (!tokenAddressesAndRolesEncoded) {
      return [];
    }

    const tokenAddressesAndRoles: TokenRoles[] = [];
    let currentAddressRoles = new TokenRoles();
    for (const valueEncoded of tokenAddressesAndRolesEncoded) {
      const address = BinaryUtils.tryBase64ToAddress(valueEncoded);
      if (address) {
        if (currentAddressRoles.address) {
          tokenAddressesAndRoles.push(currentAddressRoles);
        }

        currentAddressRoles = new TokenRoles();
        currentAddressRoles.address = address;

        continue;
      }

      const role = BinaryUtils.base64Decode(valueEncoded);
      TokenHelpers.setTokenRole(currentAddressRoles, role);
    }

    if (currentAddressRoles.address) {
      tokenAddressesAndRoles.push(currentAddressRoles);
    }

    return tokenAddressesAndRoles;
  }

  private async getLockedAccounts(identifier: string): Promise<EsdtLockedAccount[]> {
    return await this.cachingService.getOrSetCache(
      CacheInfo.TokenLockedAccounts(identifier).key,
      async () => await this.getLockedAccountsRaw(identifier),
      CacheInfo.TokenLockedAccounts(identifier).ttl,
    );
  }

  async getLockedAccountsRaw(identifier: string): Promise<EsdtLockedAccount[]> {
    const tokenAssets = await this.assetsService.getTokenAssets(identifier);
    if (!tokenAssets) {
      return [];
    }

    const lockedAccounts = tokenAssets.lockedAccounts;
    if (!lockedAccounts) {
      return [];
    }

    const lockedAccountsWithDescriptions: EsdtLockedAccount[] = [];
    if (Array.isArray(lockedAccounts)) {
      for (const lockedAccount of lockedAccounts) {
        lockedAccountsWithDescriptions.push({
          address: lockedAccount,
          name: undefined,
          balance: '0',
        });
      }
    } else {
      for (const address of Object.keys(lockedAccounts)) {
        lockedAccountsWithDescriptions.push({
          address,
          name: lockedAccounts[address],
          balance: '0',
        });
      }
    }

    if (Object.keys(lockedAccounts).length === 0) {
      return [];
    }

    const addresses = lockedAccountsWithDescriptions.map(x => x.address);

    const esdtLockedAccounts = await this.getAccountEsdtByAddressesAndIdentifier(identifier, addresses);

    for (const esdtLockedAccount of esdtLockedAccounts) {
      const lockedAccountWithDescription = lockedAccountsWithDescriptions.find(x => x.address === esdtLockedAccount.address);
      if (lockedAccountWithDescription) {
        lockedAccountWithDescription.balance = esdtLockedAccount.balance;
      }
    }

    return lockedAccountsWithDescriptions;
  }

  async getTokenSupply(identifier: string): Promise<EsdtSupply> {
    const { supply, minted, burned, initialMinted } = await this.gatewayService.getEsdtSupply(identifier);

    const isCollectionOrToken = identifier.split('-').length === 2;
    if (isCollectionOrToken) {
      let circulatingSupply = BigInt(supply);

      const lockedAccounts = await this.getLockedAccounts(identifier);
      if (lockedAccounts && lockedAccounts.length > 0) {
        const totalLockedSupply = lockedAccounts.sumBigInt(x => BigInt(x.balance));

        circulatingSupply = BigInt(supply) - totalLockedSupply;
      }

      return {
        totalSupply: supply,
        circulatingSupply: circulatingSupply.toString(),
        minted,
        burned,
        initialMinted,
        lockedAccounts,
      };
    }

    return {
      totalSupply: supply,
      circulatingSupply: supply,
      minted,
      burned,
      initialMinted,
      lockedAccounts: undefined,
    };
  }

  async countAllAccounts(identifiers: string[]): Promise<number> {
    const key = `tokens:${identifiers[0]}:distinctAccounts:${randomUUID()}`;

    try {
      for (const identifier of identifiers) {
        await this.indexerService.getAllAccountsWithToken(identifier, async items => {
          const distinctAccounts: string[] = items.map(x => x.address).distinct();
          if (distinctAccounts.length > 0) {
            const chunks = BatchUtils.splitArrayIntoChunks(distinctAccounts, 100);
            for (const chunk of chunks) {
              await this.cachingService.setAdd(key, ...chunk);
            }
          }
        });
      }

      return await this.cachingService.setCount(key);
    } finally {
      await this.cachingService.deleteInCache(key);
    }
  }

  async getAccountEsdtByAddressesAndIdentifier(identifier: string, addresses: string[]): Promise<any[]> {
    return await this.indexerService.getAccountEsdtByAddressesAndIdentifier(identifier, addresses);
  }
}
