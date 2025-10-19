import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj: any;

@TypeORM.Entity()
export default class NebsCourseGpa extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  // Raw name encountered when parsing input. Used for lookup.
  @TypeORM.Index({ unique: true })
  @TypeORM.Column({ type: "varchar", length: 200 })
  name: string;

  // Link to official course if this name is an alias of an official one.
  // If set, other fields are ignored and should be resolved via official_id.
  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  official_id: number | null;

  // When this row represents an official course (official_id is null),
  // the following fields must be provided/used.
  @TypeORM.Column({ nullable: true, type: "double", default: 0.5 })
  credit: number | null;

  @TypeORM.Column({ nullable: true, type: "double", default: 4.0 })
  full_gpa: number | null;

  // Convenience: resolve to official course entity and fields
  static async resolveByName(inputName: string): Promise<NebsCourseGpa | null> {
    if (!inputName) return null;
    const name = String(inputName).trim();
    if (!name) return null;
    let course = await NebsCourseGpa.findOne({ where: { name } });
    if (!course) return null;
    if (course.official_id) {
      const official = await NebsCourseGpa.findById(course.official_id);
      return official || course; // fallback to alias if missing
    }
    return course;
  }

  async toOfficial(): Promise<NebsCourseGpa> {
    if (this.official_id) {
      const official = await NebsCourseGpa.findById(this.official_id);
      return official || this;
    }
    return this;
  }
}
