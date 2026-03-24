import type { IpAccessListRow } from "../types/database";

const { dbGetAll } = require("@modules/database") as {
    dbGetAll: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
};

interface IpAccessMap {
    [id: number]: IpAccessListRow;
}

async function getIpAccess(type: string): Promise<IpAccessMap> {
    const isWhitelist = type === "whitelist" ? 1 : 0;
    const ipList = await dbGetAll<IpAccessListRow>("SELECT id, ip FROM ip_access_list WHERE is_whitelist = ?", [isWhitelist]);
    return ipList.reduce<IpAccessMap>((ips: IpAccessMap, ip: IpAccessListRow) => {
        ips[ip.id] = ip;
        return ips;
    }, {});
}

module.exports = {
    getIpAccess,
};
