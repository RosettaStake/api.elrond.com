import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ApiConfigService } from "src/helpers/api.config.service";
import { CachingService } from "src/helpers/caching.service";
import { GatewayService } from "src/helpers/gateway.service";
import { bech32Decode, oneHour, oneMinute } from "src/helpers/helpers";
import { VmQueryService } from "src/endpoints/vm.query/vm.query.service";
import { NodeStatus } from "../nodes/entities/node.status";
import { NodeType } from "../nodes/entities/node.type";
import { NodeService } from "../nodes/node.service";
import { Stake } from "./entities/stake";
import { StakeTopup } from "./entities/stake.topup";

@Injectable()
export class StakeService {
  private logger: Logger;

  constructor(
    private readonly cachingService: CachingService,
    private readonly vmQueryService: VmQueryService,
    private readonly apiConfigService: ApiConfigService,
    @Inject(forwardRef(() => NodeService))
    private readonly nodeService: NodeService,
    private readonly gatewayService: GatewayService,
  ) {
    this.logger = new Logger(StakeService.name);
  }

  async getGlobalStake() {
    return await this.cachingService.getOrSetCache(
      'stake',
      async () => await this.getGlobalStakeRaw(),
      oneMinute() * 10
    );
  }

  async getGlobalStakeRaw() {
    const [
      validators,
      {
        metrics: 
        {   
          erd_total_base_staked_value: totalBaseStaked,
          erd_total_top_up_value: totalTopUp,        
        },
      },
    ] = await Promise.all([this.getValidators(), this.gatewayService.get('network/economics')]);

    const totalStaked = BigInt(BigInt(totalBaseStaked) + BigInt(totalTopUp)).toString();
    
    return { ...validators, totalStaked };
  }

  async getValidators() {
    const [[queueSize], nodes] = await Promise.all([
      this.vmQueryService.vmQuery(
        this.apiConfigService.getStakingContractAddress(),
        'getQueueSize',
      ),
      this.nodeService.getAllNodes(),
    ]);
  
    return {
      totalValidators: nodes.filter(
        ({ type, status }) => type === NodeType.validator && [ NodeStatus.eligible, NodeStatus.waiting ].includes(status ?? NodeStatus.unknown)
      ).length,
      activeValidators: nodes.filter(
        ({ type, status, online }) =>
          type === NodeType.validator && [ NodeStatus.eligible, NodeStatus.waiting ].includes(status ?? NodeStatus.unknown) && online === true
      ).length,
      queueSize: parseInt(Buffer.from(queueSize, 'base64').toString()),
    };
  };

  async getStakes(addresses: string[]) {
    return await this.cachingService.getOrSetCache(
      'stakes',
      async () => this.getStakesRaw(addresses),
      oneHour()
    );
  }

  async getStakesRaw(addresses: string[]): Promise<Stake[]> {
    const stakes = await this.getStakedTopups(addresses);
  
    const value: Stake[] = [];
  
    stakes.forEach(({ stake, topUp, locked, blses }) => {
      blses.forEach((bls) => {
        value.push({ bls, stake, topUp, locked });
      });
    });
  
    return value;
  };

  async getStakedTopups(addresses: string[]) {
    return this.cachingService.batchProcess(
      addresses,
      address => `stakeTopup:${address}`,
      async address => await this.getStakedTopupRaw(address),
      oneMinute() * 15
    );
  }

  async getStakedTopupRaw(address: string): Promise<StakeTopup> {
    let response: string[] | undefined;
    try {
      response = await this.vmQueryService.vmQuery(
        this.apiConfigService.getAuctionContractAddress(),
        'getTotalStakedTopUpStakedBlsKeys',
        this.apiConfigService.getAuctionContractAddress(),
        [ bech32Decode(address) ],
      );
    } catch (error) {
      this.logger.log(error);
      response = undefined;
    }

    if (!response) {
      return {
        topUp: '0',
        stake: '0',
        locked: '0',
        numNodes: 0,
        address,
        blses: []
      };
    }
  
    const [topUpBase64, stakedBase64, numNodesBase64, ...blsesBase64] = response || [];
  
    const numNodesHex = Buffer.from(numNodesBase64, 'base64').toString('hex');
    const numNodes = BigInt(numNodesHex ? '0x' + numNodesHex : numNodesHex);
  
    const topUpHex = Buffer.from(topUpBase64, 'base64').toString('hex');
    const totalTopUp = BigInt(topUpHex ? '0x' + topUpHex : topUpHex);
  
    const stakedHex = Buffer.from(stakedBase64, 'base64').toString('hex');
    const totalStaked = BigInt(stakedHex ? '0x' + stakedHex : stakedHex) - totalTopUp;
  
    const totalLocked = totalStaked + totalTopUp;
  
    const blses = blsesBase64.map((nodeBase64) => Buffer.from(nodeBase64, 'base64').toString('hex'));
  
    if (totalStaked.toString() === '0' && numNodes.toString() === '0') {
      return {
        topUp: '0',
        stake: '0',
        locked: '0',
        numNodes: parseInt(numNodes.toString()),
        address,
        blses,
      };
    } else {
      const topUp = String(totalTopUp / numNodes);
      const stake = String(totalStaked / numNodes);
      const locked = String(totalLocked / numNodes);
  
      return {
        topUp,
        stake,
        locked,
        numNodes: parseInt(numNodes.toString()),
        address,
        blses,
      };
    }
  };
}