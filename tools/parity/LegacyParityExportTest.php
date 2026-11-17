<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\ModifierGroup;
use App\Models\ModifierOption;
use App\Models\PricingRule;
use App\Models\Product;
use App\Models\Shop;
use App\Services\GuestOrderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * Bite parity harness: legacy side. NOT part of the Laravel suite.
 *
 * tools/parity/export-legacy.sh copies this into the legacy app, runs it and
 * deletes it. It builds seeded random menus/carts, prices them through the
 * REAL GuestOrderService::buildOrderItems (same path as quote()/create()),
 * and writes inputs + outputs as JSON for packages/core parity tests.
 */
class LegacyParityExportTest extends TestCase
{
    use RefreshDatabase;

    private const CASES = 400;

    public function test_export(): void
    {
        $out = getenv('PARITY_OUT') ?: base_path('parity-cases.json');
        mt_srand((int) (getenv('PARITY_SEED') ?: 20261117));
        $service = app(GuestOrderService::class);
        $cases = [];

        for ($n = 0; $n < self::CASES; $n++) {
            $cases[] = $this->runCase($service, $n);
        }

        file_put_contents($out, json_encode([
            'generatedBy' => 'tools/parity/LegacyParityExportTest.php',
            'seed' => (int) (getenv('PARITY_SEED') ?: 20261117),
            'cases' => $cases,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION));
        $this->assertCount(self::CASES, $cases);
        Carbon::setTestNow();
    }

    private function baisa(int $b): string
    {
        return number_format($b / 1000, 3, '.', '');
    }

    /** Prices biased toward values that hit rounding halves. */
    private function randPrice(): int
    {
        return match (mt_rand(0, 4)) {
            0 => mt_rand(1, 40) * 5,
            1 => mt_rand(1, 20) * 105,
            2 => mt_rand(0, 9999),
            3 => mt_rand(1, 40) * 250,
            default => mt_rand(100, 20000),
        };
    }

    private function randPercent(): string
    {
        // whole bps only: up to 2 decimals of a percent
        return match (mt_rand(0, 2)) {
            0 => (string) (mt_rand(1, 10) * 5),
            1 => number_format(mt_rand(1, 9999) / 100, 2, '.', ''),
            default => (string) mt_rand(1, 100),
        };
    }

    private function runCase(GuestOrderService $service, int $n): array
    {
        $shopTax = [0, 5, 5, 5, 10, 5.5, 12.25][mt_rand(0, 6)];
        $shop = Shop::factory()->create(['tax_rate' => $shopTax, 'slug' => "parity-shop-$n"]);
        $categories = [];
        foreach (range(1, mt_rand(1, 3)) as $i) {
            $categories[] = Category::create(['shop_id' => $shop->id, 'name_en' => "Cat $i"]);
        }

        $products = [];
        foreach (range(1, mt_rand(1, 6)) as $i) {
            $onSale = mt_rand(0, 9) < 3;
            $type = mt_rand(0, 1) ? 'percentage' : 'fixed';
            $products[] = Product::forceCreate([
                'shop_id' => $shop->id,
                'category_id' => $categories[array_rand($categories)]->id,
                'name_en' => "Product $i",
                'price' => $this->baisa($this->randPrice()),
                'tax_rate' => [null, null, null, 0, 5, 10][mt_rand(0, 5)],
                'is_on_sale' => $onSale,
                'discount_type' => $type,
                'discount_value' => $onSale ? ($type === 'percentage' ? $this->randPercent() : $this->baisa($this->randPrice())) : null,
                'is_available' => true,
                'is_visible' => true,
            ]);
        }

        $groups = [];
        foreach ($products as $product) {
            foreach (range(0, mt_rand(0, 2)) as $g) {
                if ($g === 0) {
                    continue;
                }
                $group = ModifierGroup::create([
                    'shop_id' => $shop->id,
                    'name_en' => "Group {$product->id}-$g",
                    'min_selection' => 0,
                    'max_selection' => mt_rand(1, 3),
                ]);
                foreach (range(1, mt_rand(1, 4)) as $o) {
                    ModifierOption::create([
                        'modifier_group_id' => $group->id,
                        'name_en' => "Opt $o",
                        'price_adjustment' => $this->baisa(mt_rand(0, 5) === 0 ? -mt_rand(1, 3000) : mt_rand(0, 1500)),
                    ]);
                }
                $product->modifierGroups()->attach($group->id);
                $groups[] = $group->fresh('options');
            }
        }

        $now = Carbon::create(2026, mt_rand(1, 12), mt_rand(1, 28), mt_rand(0, 23), mt_rand(0, 59), mt_rand(0, 59), 'UTC');
        $rules = [];
        foreach (range(0, mt_rand(0, 3)) as $r) {
            if ($r === 0) {
                continue;
            }
            $target = mt_rand(0, 2);
            $type = mt_rand(0, 1) ? 'percentage' : 'fixed';
            $around = mt_rand(0, 1);
            $start = $around ? $now->copy()->subMinutes(mt_rand(0, 300)) : $now->copy()->addMinutes(mt_rand(1, 300));
            $end = $around ? $now->copy()->addMinutes(mt_rand(0, 300)) : $now->copy()->addMinutes(mt_rand(301, 600));
            if ($start->toDateString() !== $now->toDateString()) {
                $start = $now->copy()->startOfDay();
            }
            if ($end->toDateString() !== $now->toDateString()) {
                $end = $now->copy()->setTime(23, 59, 59);
            }
            $rules[] = PricingRule::create([
                'shop_id' => $shop->id,
                'name' => "Rule $r",
                'product_id' => $target === 2 ? $products[array_rand($products)]->id : null,
                'category_id' => $target === 1 ? $categories[array_rand($categories)]->id : null,
                'discount_type' => $type,
                'discount_value' => $type === 'percentage' ? $this->randPercent() : $this->baisa(mt_rand(1, 3000)),
                'start_time' => $start->format(mt_rand(0, 1) ? 'H:i' : 'H:i:s'),
                'end_time' => $end->format('H:i:s'),
                'days_of_week' => mt_rand(0, 1) ? null : array_values(array_unique([(int) $now->dayOfWeek, mt_rand(0, 6)])),
                'is_active' => mt_rand(0, 9) > 0,
            ]);
        }

        $cart = [];
        foreach (range(1, mt_rand(1, 6)) as $l) {
            $product = $products[array_rand($products)]->fresh('modifierGroups.options');
            $selected = [];
            foreach ($product->modifierGroups as $group) {
                $ids = $group->options->pluck('id')->shuffle()->take(mt_rand(0, $group->max_selection))->values()->all();
                if ($ids) {
                    $selected[$group->id] = $ids;
                }
            }
            $cart[] = ['id' => $product->id, 'name' => $product->name_en, 'quantity' => mt_rand(1, 10), 'selectedModifiers' => $selected];
        }

        Carbon::setTestNow($now);
        $built = $service->buildOrderItems($shop->fresh(), $cart, $service->fetchOrderableProducts($shop, $cart));
        $this->assertNull($built['error'], "case $n: {$built['error']}");
        $activeRuleIds = $service->loadActivePricingRules($shop)->pluck('id')->all();
        Carbon::setTestNow();

        $f = fn ($x) => number_format(round((float) $x, 3), 3, '.', '');

        return [
            'n' => $n,
            'now' => $now->format('Y-m-d H:i:s'),
            'weekday' => (int) $now->dayOfWeek,
            'shopTaxRate' => (string) $shop->fresh()->tax_rate,
            'products' => array_map(fn (Product $p) => [
                'id' => $p->id,
                'categoryId' => $p->category_id,
                'price' => (string) $p->fresh()->price,
                'taxRate' => $p->fresh()->tax_rate === null ? null : (string) $p->fresh()->tax_rate,
                'isOnSale' => (bool) $p->is_on_sale,
                'discountType' => $p->discount_type,
                'discountValue' => $p->fresh()->discount_value === null ? null : (string) $p->fresh()->discount_value,
                'modifierGroupIds' => $p->modifierGroups()->pluck('modifier_groups.id')->all(),
            ], $products),
            'modifierGroups' => array_map(fn ($g) => [
                'id' => $g->id,
                'max' => (int) $g->max_selection,
                'options' => $g->options->map(fn ($o) => ['id' => $o->id, 'priceAdjustment' => (string) $o->price_adjustment])->all(),
            ], $groups),
            'rules' => array_map(fn (PricingRule $r) => [
                'id' => $r->id,
                'productId' => $r->product_id,
                'categoryId' => $r->category_id,
                'discountType' => $r->discount_type,
                'discountValue' => (string) $r->fresh()->getRawOriginal('discount_value'),
                'startTime' => $r->start_time,
                'endTime' => $r->end_time,
                'daysOfWeek' => $r->days_of_week,
                'isActive' => (bool) $r->is_active,
            ], $rules),
            'activeRuleIds' => $activeRuleIds,
            'cart' => array_map(fn ($c) => [
                'productId' => $c['id'],
                'quantity' => $c['quantity'],
                'modifierOptionIds' => array_merge(...array_values($c['selectedModifiers'] ?: [[]])),
            ], $cart),
            'legacy' => [
                'items' => array_map(fn ($i) => ['productId' => $i['product_id'], 'priceSnapshot' => $f($i['price_snapshot']), 'quantity' => $i['quantity']], $built['items']),
                'subtotal' => $f($built['subtotal']),
                'tax' => $f($built['tax']),
                'total' => $f(round($built['subtotal'] + $built['tax'], 3)),
                'rawSubtotal' => var_export((float) $built['subtotal'], true),
                'rawTax' => var_export((float) $built['tax'], true),
            ],
        ];
    }
}
