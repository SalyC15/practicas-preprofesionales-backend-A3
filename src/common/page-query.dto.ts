import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export class PageQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000)
  page = 1

  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 25

  @IsOptional() @IsString() @MaxLength(100)
  search?: string

  @IsOptional() @IsString() @MaxLength(50)
  modality?: string
}

export function pageResult<T>(items: T[], total: number, query: PageQueryDto) {
  return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }
}
