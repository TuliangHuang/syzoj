import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj: any;

@TypeORM.Entity()
export default class RegistrationRequest extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Index({ unique: true })
  @TypeORM.Column({ type: "varchar", length: 80 })
  username: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
  email: string | null;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  nickname: string | null;

  // Store hashed password (as upstream stores raw; we follow existing convention)
  @TypeORM.Column({ type: "varchar", length: 120 })
  password: string;

  // pending | approved | rejected
  @TypeORM.Index()
  @TypeORM.Column({ type: "varchar", length: 20, default: "pending" })
  status: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  reviewer_id: number | null;

  @TypeORM.Column({ nullable: true, type: "text" })
  review_reason: string | null;

  @TypeORM.Column({ type: "integer" })
  created_time: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  decided_time: number | null;
}
