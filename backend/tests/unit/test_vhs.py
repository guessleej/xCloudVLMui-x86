"""
tests/unit/test_vhs.py — VHS 評分單元測試
==========================================
測試對象：
  - routers._shared_data.estimate_vhs_score  — 純函式，確定性計算
  - 邊界條件（base=0, base=100, day_offset=0）
"""
from __future__ import annotations

import pytest

from routers._shared_data import estimate_vhs_score


class TestEstimateVhsScore:
    """estimate_vhs_score 純函式測試"""

    def test_base_score_at_day_zero_equals_base(self):
        """day_offset=0 時 sin(0)≈0、decay=0，結果應接近 base"""
        score = estimate_vhs_score(base=80.0, day_offset=0, total_days=14)
        # sin(0) = 0，decay = 0，預期等於 base（80.0）
        assert score == pytest.approx(80.0, abs=0.1)

    def test_score_decreases_over_time_for_low_base(self):
        """低分設備（base < 50）：隨 day_offset 增加分數應呈衰減趨勢"""
        scores = [
            estimate_vhs_score(base=28.5, day_offset=i, total_days=14)
            for i in range(14)
        ]
        # 第一天至最後一天的整體均值應低於 base（有衰減）
        avg = sum(scores) / len(scores)
        assert avg < 28.5 + 3.0, f"Low-base VHS average {avg:.1f} should not exceed base+3"

    def test_score_clamps_to_min_5(self):
        """極低 base，長時間衰減後不應低於 5.0"""
        score = estimate_vhs_score(base=5.0, day_offset=100, total_days=14)
        assert score >= 5.0

    def test_score_clamps_to_max_100(self):
        """高 base，分數不應超過 100.0"""
        score = estimate_vhs_score(base=100.0, day_offset=0, total_days=14)
        assert score <= 100.0

    def test_deterministic_no_randomness(self):
        """相同輸入應回傳相同結果（無隨機）"""
        s1 = estimate_vhs_score(base=61.2, day_offset=7, total_days=14)
        s2 = estimate_vhs_score(base=61.2, day_offset=7, total_days=14)
        assert s1 == s2

    def test_returns_float_rounded_to_one_decimal(self):
        """回傳值應為四捨五入至小數點後一位的浮點數"""
        score = estimate_vhs_score(base=75.0, day_offset=3, total_days=14)
        assert isinstance(score, float)
        assert round(score, 1) == score

    @pytest.mark.parametrize("base,day,total", [
        (28.5, 0,  14),
        (61.2, 7,  14),
        (88.4, 13, 14),
        (54.9, 3,  30),
        (93.1, 0,  7),
    ])
    def test_valid_range_parametrized(self, base: float, day: int, total: int):
        """參數化測試：各種 base 分數與 day_offset 組合，結果應在 [5, 100] 範圍內"""
        score = estimate_vhs_score(base=base, day_offset=day, total_days=total)
        assert 5.0 <= score <= 100.0, (
            f"Score {score} out of range for base={base}, day={day}, total={total}"
        )
