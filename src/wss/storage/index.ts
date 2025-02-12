import { Mapper } from "../../@";

export interface repsWSS {
  role: "maker" | "joiner" | "god";
}

class ClientStorage extends Mapper<string, Mapper<string, repsWSS>> {}

export const STORAGE = new ClientStorage();
