import {ApiProperty} from "@nestjs/swagger";
import {SwaggerUtils} from "@multiversx/sdk-nestjs";

export class Delegator {
    constructor(init?: Partial<Delegator>) {
        Object.assign(this, init);
    }

    @ApiProperty({ type: String, description: 'Contract bech32 address', example: 'erd1qga7ze0l03chfgru0a32wxqf2226nzrxnyhzer9lmudqhjgy7ycqjjyknz' })
    contract: string = '';

    @ApiProperty({ type: String, description: 'Account bech32 address', example: 'erd1qga7ze0l03chfgru0a32wxqf2226nzrxnyhzer9lmudqhjgy7ycqjjyknz' })
    address: string = '';

    @ApiProperty(SwaggerUtils.amountPropertyOptions({ description: 'Delegator\' active stake' }))
    activeStake: string = '';

    @ApiProperty(SwaggerUtils.amountPropertyOptions({ description: 'Delegator\' active stake number (decoded)' }))
    activeStakeNum: string = '';
}
