import {  Controller,
  DefaultValuePipe,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query, } from "@nestjs/common";
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { ProviderService } from "./provider.service";
import { Provider } from "./entities/provider";
import { ParseAddressArrayPipe, ParseAddressPipe, ElasticSortOrder } from "@multiversx/sdk-nestjs";
import { ProviderFilter } from "./entities/provider.filter";
import {Delegator} from "./entities/delegator";

@Controller()
@ApiTags('providers')
export class ProviderController {
  constructor(private readonly providerService: ProviderService) { }

  @Get("/providers")
  @ApiOperation({ summary: 'Providers', description: 'Returns a list of all providers' })
  @ApiOkResponse({ type: [Provider] })
  @ApiQuery({ name: 'identity', description: 'Search by identity', required: false })
  @ApiQuery({ name: 'providers', description: 'Search by multiple providers address', required: false })
  async getProviders(
    @Query('identity') identity?: string,
    @Query('providers', ParseAddressArrayPipe) providers?: string[],
  ): Promise<Provider[]> {
    return await this.providerService.getProviders(new ProviderFilter({ identity, providers }));
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
      @Query('stakeFrom', new DefaultValuePipe(0), ParseIntPipe) stakeFrom: number,
      @Query('stakeTo', new DefaultValuePipe(0), ParseIntPipe) stakeTo: number,
      @Param('address', ParseAddressPipe) address: string): Promise<Delegator[]> {
    const provider = await this.providerService.getDelegatorsList(address, { from, size }, order === 'desc' ? ElasticSortOrder.descending : ElasticSortOrder.ascending, stakeFrom, stakeTo);
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
      @Query('stakeFrom', new DefaultValuePipe(0), ParseIntPipe) stakeFrom: number,
      @Query('stakeTo', new DefaultValuePipe(0), ParseIntPipe) stakeTo: number,
  ): Promise<number> {
    return await this.providerService.getDelegatorsCount(address, stakeFrom, stakeTo);
  }
}
