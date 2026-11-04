import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class InitSwarmDto {
  /** IP (or IP:port) other nodes use to reach this manager; empty = daemon picks. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9.:-]*$/, {
    message: 'advertiseAddr must be an address',
  })
  advertiseAddr?: string;

  /**
   * Address the swarm control port (2377) listens on, `host` or `host:port`.
   * Empty = the advertise address, or every interface when there is none.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^([A-Za-z0-9.-]+(:\d{1,5})?)?$/, {
    message: 'listenAddr must be host or host:port',
  })
  listenAddr?: string;

  /**
   * `com.docker.network.driver.mtu` of the `aoox-swarm` overlay = the MTU of the
   * network UNDER the VXLAN (the tunnel MTU, 1420 for WireGuard); Docker takes
   * 50 off inside containers (1370). Default 1500 -> containers 1450.
   */
  @IsOptional()
  @IsInt()
  @Min(576)
  @Max(9000)
  overlayMtu?: number;
}
