import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query,
} from "@nestjs/common";
import {ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags} from "@nestjs/swagger";
import {ProviderService} from "./provider.service";
import {Provider} from "./entities/provider";
import {ProviderFilter} from "./entities/provider.filter";
import {ElasticSortOrder, ParseAddressPipe} from "@elrondnetwork/erdnest";
import {Delegator} from "./entities/delegator";

@Controller()
@ApiTags('providers')
export class ProviderController {
  constructor(private readonly providerService: ProviderService) { }

  @Get("/providers")
  @ApiOperation({ summary: 'Providers', description: 'Returns a list of all providers' })
  @ApiOkResponse({ type: [Provider] })
  @ApiQuery({ name: 'identity', description: 'Search by identity', required: false })
  async getProviders(
    @Query('identity') identity?: string,
  ): Promise<Provider[]> {
    return await this.providerService.getProviders(new ProviderFilter({ identity }));
  }

  @Get('/providers/:address')
  @ApiOperation({ summary: 'Provider', description: 'Returns provider details for a given address' })
  @ApiOkResponse({ type: Provider })
  @ApiNotFoundResponse({ description: 'Provider not found' })
  async getProvider(@Param('address', ParseAddressPipe) address: string): Promise<Provider> {
    const provider = await this.providerService.getProvider(address);
    if (provider === undefined) {
      throw new HttpException(`Provider '${address}' not found`, HttpStatus.NOT_FOUND);
    }

    return provider;
  }

  @Get('/providers/:address/delegators')
  @ApiOperation({ summary: 'Provider\' delegators list', description: 'Returns provider\'s delegators list for a given address' })
  @ApiOkResponse({ type: [Delegator] })
  @ApiNotFoundResponse({ description: 'Provider not found' })
  async getProviderDelegators(
      @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
      @Query("size", new DefaultValuePipe(25), ParseIntPipe) size: number,
      @Query("order", new DefaultValuePipe('desc')) order: string,
      @Param('address', ParseAddressPipe) address: string): Promise<Delegator[]> {
    const provider = await this.providerService.getDelegatorsList(address, { from, size }, order === 'desc' ? ElasticSortOrder.descending : ElasticSortOrder.ascending);
    if (provider === undefined) {
      throw new HttpException(`Provider '${address}' not found`, HttpStatus.NOT_FOUND);
    }

    return provider;
  }


  @Get("/providers/:address/delegators/count")
  @ApiOperation({ summary: 'Total number of delegators', description: 'Returns total number of delegators of provider' })
  @ApiOkResponse({ type: Number })
  async getAccountsCount(
      @Param('address', ParseAddressPipe) address: string,
      @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
      @Query('to', new DefaultValuePipe(0), ParseIntPipe) to: number,
  ): Promise<number> {
    return await this.providerService.getDelegatorsCount(address, from, to);
  }
}
