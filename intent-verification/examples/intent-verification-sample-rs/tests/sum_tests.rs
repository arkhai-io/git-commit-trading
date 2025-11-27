use intent_verification_sample_rs::sum;

#[test]
fn test_sum() {
    let result = sum(2, 2);
    assert_eq!(result, 4);
}
