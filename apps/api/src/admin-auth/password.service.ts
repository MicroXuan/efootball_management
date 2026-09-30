import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

const BCRYPT_COST = 10;

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password, BCRYPT_COST);
  }

  verify(password: string, passwordHash: string): Promise<boolean> {
    return compare(password, passwordHash);
  }
}
