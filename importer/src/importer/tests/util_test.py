from importer.util import sanitize_id, interp_string


def test_sanitize_id():

    text = "add_column - Adds a column from the input dataset.  If no value or generator is defined, will be initialized to NULL"

    expected_ouput = "add_column---adds-a-column-from-the-input-dataset--if-no-value-or-generator-is-defined-will-be-initialized-to-null"

    assert sanitize_id(text) == expected_ouput

    text = "db_filter - Generally used to define the state.  If not defined, input data set is assumed to be National !"

    expected_ouput = "db_filter---generally-used-to-define-the-state--if-not-defined-input-data-set-is-assumed-to-be-national-"

    assert sanitize_id(text) == expected_ouput

    text = "path - Set to the path *from the docker container* to the input data set"

    expected_ouput = "path---set-to-the-path-from-the-docker-container-to-the-input-data-set"

    assert sanitize_id(text) == expected_ouput

    text = "set_column_by_join - Fills in null values by joining an existing master view/table via attribute.    For example, a ward (admin 3) could join the lga table in order to retrieve the lga tables state_code value."

    expected_ouput = "set_column_by_join---fills-in-null-values-by-joining-an-existing-master-viewtable-via-attribute----for-example-a-ward-admin-3-could-join-the-lga-table-in-order-to-retrieve-the-lga-tables-state_code-value"

    assert sanitize_id(text) == expected_ouput

    text = "string_replace - Performs string replacement. Useful for repeated spelling corrections."

    expected_ouput = "string_replace---performs-string-replacement-useful-for-repeated-spelling-corrections"

    assert sanitize_id(text) == expected_ouput

#pytest /python_src/importer/tests/util_test.py --rootdir /python_src -k interp
def test_interp_string():

    text = " hello "
    expected_output = "\" hello \""

    assert interp_string(text) == expected_output

    text = " hello ${col1}"
    expected_output = "\" hello \" + gdf['col1']"

    assert interp_string(text) == expected_output

    text = " hello ${col1} "
    expected_output = "\" hello \" + gdf['col1'] + \" \""

    assert interp_string(text) == expected_output

    text = "${col 2} hello ${col1} "
    expected_output = "gdf['col 2'] + \" hello \" + gdf['col1'] + \" \""

    assert interp_string(text) == expected_output
